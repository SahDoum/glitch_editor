import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
} from "react";
import type { JpegOutputMode } from "./jpeg/encode-options";
import { encodeJpegCoefficients } from "./application/coefficient-reader";
import {
  createJpegDocumentSession,
  type JpegEditableState,
} from "./application/jpeg-document";
import {
  DEFAULT_EFFECT_ID,
  EFFECT_MENU,
  EFFECT_REGISTRY,
  getEffect,
  getScanCorruptionEffect,
  getStorageKey,
  mergeSettings,
  type ErasedSettings,
} from "./features/effects/registry";
import {
  persistEffectSettings,
  readPersistedEffectSettings,
  type PersistedEffectSettings,
} from "./features/effects/settings-persistence";
import { importJpeg, type ImportedJpeg } from "./application/import-jpeg";
import {
  previewDimensions,
  previewOrientationTransform,
  readJpegOrientation,
} from "./application/preview-orientation";
import type { JpegOrientation } from "./jpeg/orientation";
import {
  createJgeProjectFile,
  readJgeProjectFile,
  type JgeProjectData,
} from "./project/project-file";
import {
  getMaskBlockCoveragePath,
  type JpegBlockGeometry,
  type JpegBlockCoordinate,
  type JpegSelectionGrid,
} from "./jpeg/block-geometry";
import type { JpegInspection } from "./jpeg/inspect";
import {
  copySpatialMask,
  type SpatialMask,
  type SpatialSelection,
} from "./document/masks";
import type { ProjectDocument } from "./document/model";
import { OperationHistory } from "./operations/history";
import type { JpegGlitchOperation } from "./operations/jpeg-glitch";
import { EditorBridge } from "./features/effects/editor-bridge";
import { PreviewCoordinator } from "./application/preview-coordinator";
import {
  readBrushAutoApply,
  writeBrushAutoApply,
} from "./application/coefficient-brushes";
import {
  initialWorkspaceState,
  getWorkspaceOverlayVisibility,
  getWorkspaceShortcut,
  workspaceReducer,
  type MaskTool,
} from "./ui/workspace-state";
import { getRectangleSelection } from "./ui/selection-overlay";
import { ScanCorruptionHistory } from "./application/scan-corruption";
import {
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
  type ScanCorruptionReport,
} from "./jpeg/scan-corruption";
import type { ScanDecodeDiagnostic } from "./jpeg/scan-corruption-worker-protocol";
import { CollapsibleSection } from "./ui/collapsible-section";
import type {
  EffectEditor,
  EffectTopBarAction,
} from "./features/effects/types";
import { isJpegOperationController } from "./features/effects/types";
import { EffectCatalogPanel } from "./ui/effect-catalog-panel";
import { createWholeImageMask } from "./features/canvas-tools/all-tool";
import {
  createCanvasToolControllers,
  getMaskToolView,
} from "./features/canvas-tools/registry";
import type {
  CanvasContext,
  CanvasFeedback,
  CanvasInteraction,
  ImagePoint,
  MaskDraft,
  MaskToolContext,
} from "./features/canvas-tools/types";
import { CanvasPointer, getCanvasPointerInput } from "./ui/canvas-pointer";
import { EffectCanvasInteraction } from "./ui/canvas-tool-gestures";
import { CanvasToolbar } from "./ui/canvas-toolbar";
import { OperationHistoryPanel } from "./ui/operation-history";
import {
  getJpegComponentLabels,
  identifyJpegColorModel,
  type JpegComponentLabel,
} from "./jpeg/color-model";

const APPLICATION_VERSION = "0.1.0";
const JPEG_CODEC_VERSION = "libjpeg-turbo 3.2.0";
const EMPTY_JPEG_OPERATIONS: JpegEditableState["jpegOperations"] =
  Object.freeze([]);
const NO_TOOLS: ReadonlySet<MaskTool> = new Set();

/** Defaults overlaid with the settings a user saved in this browser. */
function createEffectSettings(
  persisted: PersistedEffectSettings,
): Readonly<Record<string, ErasedSettings>> {
  return Object.fromEntries(
    EFFECT_REGISTRY.map(({ view }) => [
      view.id,
      { ...view.defaultSettings, ...persisted[view.id] },
    ]),
  );
}

function createJpegPreviewUrl(bytes: Uint8Array): string {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
}

function ImageOverlays({
  inspection,
  orientation,
  showBlocks,
  showMcus,
  selection,
  mask,
  brushDraft,
  brushCursorPoint,
  brushRadius,
  componentId,
  keyboardCursor,
  gestureSource,
  gestureSourceInvalid,
  gestureDestination,
  gestureDestinationInvalid,
}: {
  inspection: JpegInspection;
  orientation: JpegOrientation;
  showBlocks: boolean;
  showMcus: boolean;
  selection: SpatialSelection | null;
  mask: SpatialMask | null;
  brushDraft: Extract<MaskDraft, { kind: "brush" }> | null;
  brushCursorPoint: ImagePoint | null;
  brushRadius: number;
  componentId: number;
  keyboardCursor: JpegBlockCoordinate | null;
  gestureSource: SpatialSelection | null;
  gestureSourceInvalid: boolean;
  gestureDestination: SpatialSelection | null;
  gestureDestinationInvalid: boolean;
}) {
  const blockPatternWidth = inspection.blockWidth;
  const blockPatternHeight = inspection.blockHeight;
  const hasActiveBrush =
    mask?.width === inspection.width && mask.height === inspection.height
      ? mask.shapes.some((shape) => shape.kind === "brush")
      : false;
  const activeBrushCoverage =
    mask && hasActiveBrush
      ? getMaskBlockCoveragePath(mask, inspection, componentId)
      : null;
  const draftBrushMask: SpatialMask | null = brushDraft?.strokes.some(
    (stroke) => stroke.length > 0,
  )
    ? {
        schemaVersion: 1,
        id: "brush-draft",
        width: inspection.width,
        height: inspection.height,
        shapes: brushDraft.strokes.flatMap((points) =>
          points.length > 0
            ? [
                {
                  kind: "brush",
                  mode: "add",
                  radius: brushDraft.radius,
                  points,
                },
              ]
            : [],
        ),
      }
    : null;
  const draftBrushCoverage = draftBrushMask
    ? getMaskBlockCoveragePath(draftBrushMask, inspection, componentId)
    : null;

  const dimensions = previewDimensions(inspection, orientation);
  return (
    <svg
      className="image-overlays"
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g
        transform={previewOrientationTransform(
          inspection.width,
          inspection.height,
          orientation,
        )}
      >
        <defs>
          <pattern
            id="block-grid"
            width={blockPatternWidth}
            height={blockPatternHeight}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${blockPatternWidth} 0 V ${blockPatternHeight} M 0 ${blockPatternHeight} H ${blockPatternWidth}`}
              fill="none"
              stroke="#c8f169"
              strokeOpacity="0.62"
              strokeWidth="0.45"
            />
          </pattern>
          <pattern
            id="mcu-grid"
            width={inspection.mcuWidth}
            height={inspection.mcuHeight}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${inspection.mcuWidth} 0 V ${inspection.mcuHeight} M 0 ${inspection.mcuHeight} H ${inspection.mcuWidth}`}
              fill="none"
              stroke="#ff9b72"
              strokeOpacity="0.9"
              strokeWidth="0.9"
            />
          </pattern>
        </defs>
        {showBlocks && (
          <rect
            width={inspection.width}
            height={inspection.height}
            fill="url(#block-grid)"
          />
        )}
        {showMcus && (
          <rect
            width={inspection.width}
            height={inspection.height}
            fill="url(#mcu-grid)"
          />
        )}
        {activeBrushCoverage?.ok && (
          <path className="active-mask-cells" d={activeBrushCoverage.value} />
        )}
        {selection && (
          <rect
            className="selection-overlay"
            x={selection.x}
            y={selection.y}
            width={selection.width}
            height={selection.height}
          />
        )}
        {gestureSource && (
          <rect
            className={`block-transfer-source-overlay ${gestureSourceInvalid ? "is-invalid" : ""}`}
            x={gestureSource.x}
            y={gestureSource.y}
            width={gestureSource.width}
            height={gestureSource.height}
          />
        )}
        {gestureDestination && (
          <rect
            className={`block-transfer-target-overlay ${gestureDestinationInvalid ? "is-invalid" : ""}`}
            x={gestureDestination.x}
            y={gestureDestination.y}
            width={gestureDestination.width}
            height={gestureDestination.height}
          />
        )}
        {draftBrushCoverage?.ok && (
          <path className="brush-draft-cells" d={draftBrushCoverage.value} />
        )}
        {brushCursorPoint && (
          <>
            <circle
              className="brush-cursor-outline"
              cx={brushCursorPoint.x}
              cy={brushCursorPoint.y}
              r={brushRadius}
            />
            <circle
              className="brush-cursor"
              cx={brushCursorPoint.x}
              cy={brushCursorPoint.y}
              r={brushRadius}
            />
          </>
        )}
        {keyboardCursor && (
          <rect
            className="keyboard-cursor-overlay"
            x={keyboardCursor.imageX}
            y={keyboardCursor.imageY}
            width={keyboardCursor.imageWidth}
            height={keyboardCursor.imageHeight}
          />
        )}
      </g>
    </svg>
  );
}

function loadInitialEffectAutoApply(): {
  settings: Readonly<Record<string, boolean>>;
  error: string;
} {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return {
      settings: {},
      error: "Effect automatic-apply settings are unavailable.",
    };
  }
  const result = readBrushAutoApply(storage);
  return result.ok
    ? { settings: result.value, error: "" }
    : { settings: {}, error: result.error.message };
}

function App() {
  const [document, setDocument] = useState<ImportedJpeg | null>(null);
  const [historyDocument, setHistoryDocument] =
    useState<ProjectDocument<JpegEditableState> | null>(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [editedBytes, setEditedBytes] = useState<Uint8Array | null>(null);
  const [editedPreviewError, setEditedPreviewError] = useState("");
  const [draftPreviewUrl, setDraftPreviewUrl] = useState<string | null>(null);
  const [draftPreviewSignature, setDraftPreviewSignature] = useState("");
  const [isDraftPreviewing, setIsDraftPreviewing] = useState(false);
  const [cleanEncodedPreviewUrl, setCleanEncodedPreviewUrl] = useState<
    string | null
  >(null);
  const [cleanEncodedPreviewError, setCleanEncodedPreviewError] = useState("");
  const [scanCorruptionReports, setScanCorruptionReports] = useState<
    readonly ScanCorruptionReport[]
  >([]);
  const [scanDecodeDiagnostic, setScanDecodeDiagnostic] =
    useState<ScanDecodeDiagnostic | null>(null);
  const [isScanCorrupting, setIsScanCorrupting] = useState(false);
  const [showCleanEncoded, setShowCleanEncoded] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [dismissedToastMessage, setDismissedToastMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Inspecting JPEG…");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [exportMode, setExportMode] = useState<JpegOutputMode>("baseline");
  const [isExporting, setIsExporting] = useState(false);
  const [projectNotice, setProjectNotice] = useState("");
  const [isEncoding, setIsEncoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showMcus, setShowMcus] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [keyboardCursor, setKeyboardCursor] =
    useState<JpegBlockCoordinate | null>(null);
  const [canvasHasKeyboardFocus, setCanvasHasKeyboardFocus] = useState(false);
  const [canvasKeyboardAnnouncement, setCanvasKeyboardAnnouncement] =
    useState("");
  const [workspaceState, dispatchWorkspace] = useReducer(workspaceReducer, {
    ...initialWorkspaceState,
    activeEffectId: DEFAULT_EFFECT_ID,
  });
  const {
    activeTool: toolMode,
    activeEffectId,
    selectionMask: globalSelectionMask,
  } = workspaceState;
  const activeToolPanel = useRef<HTMLDetailsElement>(null);
  const saveDialogRef = useRef<HTMLDialogElement>(null);
  const cleanEncodedPreviewErrorRef = useRef(cleanEncodedPreviewError);
  const [maskGrid, setMaskGrid] = useState<JpegSelectionGrid>("dct");
  const [componentIndex, setComponentIndex] = useState(0);
  const [initialPersisted] = useState(readPersistedEffectSettings);
  const persistedSettings = useRef<PersistedEffectSettings>(
    initialPersisted.settings,
  );
  const [effectSettings, setEffectSettings] = useState(() =>
    createEffectSettings(initialPersisted.settings),
  );
  const [effectSettingsError, setEffectSettingsError] = useState(
    initialPersisted.error,
  );
  const [brushSize, setBrushSize] = useState(32);
  const [initialAutoApply] = useState(loadInitialEffectAutoApply);
  const [effectAutoApply, setEffectAutoApply] = useState(
    initialAutoApply.settings,
  );
  const [effectAutoApplyError, setEffectAutoApplyError] = useState(
    initialAutoApply.error,
  );
  const [zoom, setZoom] = useState(1);
  const [maskDraft, setMaskDraft] = useState<MaskDraft | null>(null);
  const [brushCursorPoint, setBrushCursorPoint] = useState<ImagePoint | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const previewCoordinator = useRef(new PreviewCoordinator());
  const previewAbortController = useRef<AbortController | null>(null);
  const previewRequestSignature = useRef("");
  const previewCurrentEffectRef = useRef<(() => Promise<void>) | null>(null);
  const dragDepth = useRef(0);
  const importController = useRef<AbortController | null>(null);
  const operationHistory = useRef<OperationHistory<JpegEditableState> | null>(
    null,
  );
  const scanCorruptionHistory = useRef(new ScanCorruptionHistory());
  const cleanEncodedBytes = useRef<Uint8Array | null>(null);
  const scanCorruptionController = useRef<AbortController | null>(null);
  const pendingProjectStages = useRef<
    readonly ScanCorruptionParameters[] | null
  >(null);
  const projectStagesReplayStarted = useRef(false);
  const [canvasPointer] = useState(() => new CanvasPointer());
  const [canvasTools] = useState(createCanvasToolControllers);
  const spacePanActive = useRef(false);
  const imageStage = useRef<HTMLDivElement>(null);
  const previewImageWrap = useRef<HTMLDivElement>(null);
  const jpegOperations =
    historyDocument?.currentState.jpegOperations ?? EMPTY_JPEG_OPERATIONS;
  const activeMask = globalSelectionMask;
  const activeEffect = getEffect(activeEffectId ?? DEFAULT_EFFECT_ID);
  const activeView = activeEffect?.view;
  const activeSettings = activeView ? effectSettings[activeView.id] : undefined;
  const isMaskEffect = activeView?.interaction === "mask";
  const maskToolId = toolMode === "effect" ? null : toolMode;
  const maskToolView = maskToolId ? getMaskToolView(maskToolId) : null;
  const componentCount = document?.inspection.components.length ?? 0;
  const documentHash = document?.originalAsset.sha256;
  const orientation = useMemo(() => {
    if (!document) return 1;
    const result = readJpegOrientation(
      document.originalAsset.readBytes(),
      document.inspection,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }, [document]);
  const colorModel = useMemo(
    () =>
      document
        ? identifyJpegColorModel(
            document.originalAsset.readBytes(),
            document.inspection,
          )
        : null,
    [document],
  );
  const componentLabels = useMemo(
    () =>
      colorModel
        ? getJpegComponentLabels(colorModel, componentCount)
        : ([] as readonly JpegComponentLabel[]),
    [colorModel, componentCount],
  );
  function getPreviewSignature(settings: ErasedSettings | undefined) {
    return JSON.stringify({
      documentHash,
      revision: historyDocument?.revision ?? 0,
      effectId: activeView?.id ?? null,
      componentIndex,
      settings,
      maskId: isMaskEffect ? (activeMask?.id ?? null) : null,
    });
  }
  const effectPreviewSignature = getPreviewSignature(activeSettings);
  const isDraftPreviewStale =
    draftPreviewUrl !== null &&
    draftPreviewSignature !== effectPreviewSignature;
  const contextualErrorMessage = [
    effectSettingsError
      ? `${effectSettingsError} Effect settings may not be retained.`
      : "",
    effectAutoApplyError,
    documentHash && componentIndex >= componentCount
      ? `This image has no component ${componentIndex}. Choose another brush or component.`
      : "",
    scanCorruptionReports.length > 0 ? editedPreviewError : "",
    scanCorruptionReports.length > 0 &&
    cleanEncodedPreviewError &&
    !cleanEncodedPreviewUrl
      ? `The clean encoded JPEG could not be previewed: ${cleanEncodedPreviewError}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const visibleErrorMessage =
    errorMessage ||
    (contextualErrorMessage !== dismissedToastMessage
      ? contextualErrorMessage
      : "");

  useEffect(() => {
    if (previewRequestSignature.current !== effectPreviewSignature) {
      previewAbortController.current?.abort();
      previewCoordinator.current.cancel();
    }
    if (
      !activeView?.autoPreview ||
      !isMaskEffect ||
      !activeMask ||
      scanCorruptionReports.length > 0
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      const previewCurrentEffect = previewCurrentEffectRef.current;
      if (previewCurrentEffect) void previewCurrentEffect();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    activeMask,
    activeView,
    isMaskEffect,
    effectPreviewSignature,
    scanCorruptionReports.length,
  ]);

  useEffect(() => {
    const dialog = saveDialogRef.current;
    if (!dialog) return;
    if (isSaveDialogOpen && !dialog.open) dialog.showModal();
    else if (!isSaveDialogOpen && dialog.open) dialog.close();
  }, [isSaveDialogOpen]);

  useEffect(
    () => () => {
      if (document) URL.revokeObjectURL(document.previewUrl);
    },
    [document],
  );

  useEffect(
    () => () => {
      if (editedPreviewUrl) URL.revokeObjectURL(editedPreviewUrl);
    },
    [editedPreviewUrl],
  );

  useEffect(
    () => () => {
      previewAbortController.current?.abort();
      if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
    },
    [draftPreviewUrl],
  );

  useEffect(
    () => () => {
      if (cleanEncodedPreviewUrl) URL.revokeObjectURL(cleanEncodedPreviewUrl);
    },
    [cleanEncodedPreviewUrl],
  );

  useEffect(() => {
    cleanEncodedPreviewErrorRef.current = cleanEncodedPreviewError;
  }, [cleanEncodedPreviewError]);

  useEffect(() => {
    scanCorruptionController.current?.abort();
    scanCorruptionController.current = null;
    scanCorruptionHistory.current.clear();
    cleanEncodedBytes.current = null;
    if (!document || jpegOperations.length === 0) return;

    const controller = new AbortController();
    const geometry: JpegBlockGeometry = {
      width: document.inspection.width,
      height: document.inspection.height,
      components: document.inspection.components.map(
        ({ id, horizontalSampling, verticalSampling, quantizationTable }) => ({
          id,
          horizontalSampling,
          verticalSampling,
          quantizationTable,
        }),
      ),
    };

    void (async () => {
      const encoded = await encodeJpegCoefficients(
        document.originalAsset.readBytes(),
        geometry,
        jpegOperations,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!encoded.ok) {
        setErrorMessage(encoded.error.message);
        setIsEncoding(false);
        return;
      }

      cleanEncodedBytes.current = encoded.value.slice();
      const outputBuffer = new ArrayBuffer(encoded.value.byteLength);
      new Uint8Array(outputBuffer).set(encoded.value);
      const previewUrl = URL.createObjectURL(
        new Blob([outputBuffer], { type: "image/jpeg" }),
      );
      let previewError = "";
      try {
        const preview = new Image();
        preview.src = previewUrl;
        await preview.decode();
        const expected = previewDimensions(document.inspection, orientation);
        if (
          preview.naturalWidth !== expected.width ||
          preview.naturalHeight !== expected.height
        ) {
          previewError =
            "The encoded output dimensions differ from the source image.";
        }
      } catch {
        previewError =
          "The browser decoder could not render this encoded experiment. The file is still available to export.";
      }
      if (controller.signal.aborted) {
        URL.revokeObjectURL(previewUrl);
        return;
      }

      if (previewError) {
        URL.revokeObjectURL(previewUrl);
        setEditedPreviewUrl(null);
        setEditedPreviewError(previewError);
        setCleanEncodedPreviewUrl(null);
        setCleanEncodedPreviewError(previewError);
      } else {
        setEditedPreviewUrl(previewUrl);
        setEditedPreviewError("");
        setCleanEncodedPreviewUrl(
          URL.createObjectURL(
            new Blob([outputBuffer.slice(0)], { type: "image/jpeg" }),
          ),
        );
        setCleanEncodedPreviewError("");
      }
      setEditedBytes(encoded.value);
      setIsEncoding(false);
    })();

    return () => controller.abort();
  }, [document, jpegOperations, orientation]);

  useEffect(
    () => () => {
      importController.current?.abort();
      scanCorruptionController.current?.abort();
    },
    [],
  );

  async function loadFile(file: File) {
    resetCanvasInteraction();
    cancelScanCorruption();
    const currentRequest = ++requestId.current;
    importController.current?.abort();
    const controller = new AbortController();
    importController.current = controller;
    setErrorMessage("");
    setProjectNotice("");
    setIsLoading(true);
    const isProjectFile = file.name.toLowerCase().endsWith(".jpglitch");
    setLoadingMessage(isProjectFile ? "Opening project…" : "Inspecting JPEG…");

    let projectData: JgeProjectData | null = null;
    let jpegFile = file;
    if (isProjectFile) {
      const savedProject = await readJgeProjectFile(
        file,
        (message) => setLoadingMessage(message),
        controller.signal,
      );
      if (currentRequest !== requestId.current) return;
      if (!savedProject.ok) {
        importController.current = null;
        setIsLoading(false);
        setErrorMessage(savedProject.error.message);
        return;
      }
      projectData = savedProject.value;
      const sourceBuffer = new ArrayBuffer(projectData.source.bytes.byteLength);
      new Uint8Array(sourceBuffer).set(projectData.source.bytes);
      jpegFile = new File([sourceBuffer], projectData.source.fileName, {
        type: "image/jpeg",
      });
      setLoadingMessage("Inspecting embedded JPEG…");
    }

    const result = await importJpeg(jpegFile, controller.signal);
    if (currentRequest !== requestId.current) {
      if (result.ok) URL.revokeObjectURL(result.value.previewUrl);
      return;
    }

    importController.current = null;
    setIsLoading(false);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }

    const history = createJpegDocumentSession(result.value);
    if (!history.ok) {
      URL.revokeObjectURL(result.value.previewUrl);
      setErrorMessage(history.error.message);
      return;
    }
    let initialSelectionMask = projectData?.draftMask ?? null;
    if (!initialSelectionMask) {
      const mask = createWholeImageMask(result.value.inspection);
      if (!mask.ok) {
        URL.revokeObjectURL(result.value.previewUrl);
        setErrorMessage(mask.error.message);
        return;
      }
      initialSelectionMask = mask.value;
    }
    if (projectData) {
      const restored = history.value.restoreOperations(projectData.operations);
      if (!restored.ok) {
        URL.revokeObjectURL(result.value.previewUrl);
        setErrorMessage(
          `The saved operation stack could not be restored: ${restored.error.message}`,
        );
        return;
      }
      if (
        projectData.draftMask &&
        (projectData.draftMask.width !== result.value.inspection.width ||
          projectData.draftMask.height !== result.value.inspection.height)
      ) {
        URL.revokeObjectURL(result.value.previewUrl);
        setErrorMessage(
          "The saved draft mask dimensions do not match the embedded JPEG.",
        );
        return;
      }
    }

    scanCorruptionController.current?.abort();
    scanCorruptionController.current = null;
    scanCorruptionHistory.current.clear();
    cleanEncodedBytes.current = null;
    operationHistory.current = history.value;
    setHistoryDocument(history.value.snapshot);
    pendingProjectStages.current =
      projectData && projectData.scanCorruptionStages.length > 0
        ? projectData.scanCorruptionStages
        : null;
    projectStagesReplayStarted.current = false;
    previewAbortController.current?.abort();
    previewCoordinator.current.cancel();
    setDraftPreviewUrl(null);
    setDraftPreviewSignature("");
    setEditedPreviewUrl(null);
    setEditedBytes(null);
    setEditedPreviewError("");
    setCleanEncodedPreviewUrl(null);
    setCleanEncodedPreviewError("");
    setScanCorruptionReports([]);
    setScanDecodeDiagnostic(null);
    setIsScanCorrupting(false);
    setShowCleanEncoded(false);
    setIsEncoding(history.value.snapshot.operations.length > 0);
    setHistoryAvailability({
      canUndo: history.value.canUndo,
      canRedo: history.value.canRedo,
    });
    resetCanvasInteraction();
    dispatchWorkspace({ type: "reset-document" });
    dispatchWorkspace({
      type: "activate-effect",
      effectId: DEFAULT_EFFECT_ID,
      usesMaskTools: getEffect(DEFAULT_EFFECT_ID)?.view.interaction === "mask",
    });
    if (projectData?.draftMask) {
      dispatchWorkspace({ type: "activate-tool", tool: "select" });
    }
    dispatchWorkspace({
      type: "set-selection",
      selection: initialSelectionMask,
    });
    setComponentIndex(0);
    setEffectSettings(createEffectSettings(persistedSettings.current));
    setBrushSize(32);
    setMaskGrid("dct");
    dispatchWorkspace({ type: "select-mask", maskId: null });
    setShowBlocks(false);
    setShowMcus(false);
    setShowOriginal(false);
    setZoom(1);
    setDocument(result.value);
    if (
      projectData &&
      (projectData.applicationVersion !== APPLICATION_VERSION ||
        projectData.codecVersion !== JPEG_CODEC_VERSION)
    ) {
      setProjectNotice(
        `Created with app ${projectData.applicationVersion} and ${projectData.codecVersion}; replayed JPEG output may differ from its previous export.`,
      );
    }
  }

  function updateHistory(
    result: ReturnType<OperationHistory<JpegEditableState>["add"]>,
  ) {
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }
    const previousJpegOperations = historyDocument?.currentState.jpegOperations;
    if (result.value.currentState.jpegOperations !== previousJpegOperations) {
      if (scanCorruptionHistory.current.activeStages.length > 0) {
        const rolledBack = operationHistory.current?.undo();
        if (rolledBack?.ok) setHistoryDocument(rolledBack.value);
        const history = operationHistory.current;
        setHistoryAvailability({
          canUndo:
            (history?.canUndo ?? false) ||
            scanCorruptionHistory.current.canUndo,
          canRedo:
            (history?.canRedo ?? false) ||
            scanCorruptionHistory.current.canRedo,
        });
        setErrorMessage(
          "Undo Scan Corrupt before changing coefficient or DQT operations.",
        );
        return;
      }
      scanCorruptionController.current?.abort();
      scanCorruptionController.current = null;
      scanCorruptionHistory.current.clear();
      cleanEncodedBytes.current = null;
      previewAbortController.current?.abort();
      previewCoordinator.current.cancel();
      setDraftPreviewUrl(null);
      setDraftPreviewSignature("");
      setScanCorruptionReports([]);
      setScanDecodeDiagnostic(null);
      setEditedPreviewUrl(null);
      setEditedBytes(null);
      setEditedPreviewError("");
      setCleanEncodedPreviewUrl(null);
      setCleanEncodedPreviewError("");
      setIsEncoding(result.value.currentState.jpegOperations.length > 0);
      setIsScanCorrupting(false);
      setShowOriginal(false);
      setShowCleanEncoded(false);
    }
    setErrorMessage("");
    setHistoryDocument(result.value);
    const history = operationHistory.current;
    setHistoryAvailability({
      canUndo:
        (history?.canUndo ?? false) || scanCorruptionHistory.current.canUndo,
      canRedo:
        (history?.canRedo ?? false) || scanCorruptionHistory.current.canRedo,
    });
  }

  function mutateHistory(
    mutate: (
      history: OperationHistory<JpegEditableState>,
    ) => ReturnType<OperationHistory<JpegEditableState>["add"]>,
  ) {
    if (scanCorruptionHistory.current.activeStages.length > 0) {
      setErrorMessage(
        "Undo Scan Corrupt before changing coefficient or DQT operations.",
      );
      return;
    }
    const history = operationHistory.current;
    if (!history) return;
    updateHistory(mutate(history));
  }

  function publishCanvasFeedback(feedback: CanvasFeedback) {
    if (feedback.draft !== undefined) setMaskDraft(feedback.draft);
    if (feedback.keyboardCursor !== undefined)
      setKeyboardCursor(feedback.keyboardCursor);
    if (feedback.hoverPoint !== undefined)
      setBrushCursorPoint(feedback.hoverPoint);
    if (feedback.announcement !== undefined)
      setCanvasKeyboardAnnouncement(feedback.announcement);
    if (feedback.error !== undefined) setErrorMessage(feedback.error);
    if (feedback.selection) {
      const { mask, autoApply } = feedback.selection;
      dispatchWorkspace({ type: "set-selection", selection: mask });
      if (mask && autoApply && autoApplySelectionEffect(mask)) {
        dispatchWorkspace({ type: "set-selection", selection: null });
      }
    }
    if (feedback.effect) {
      const { ownerId, patch, apply } = feedback.effect;
      if (patch) {
        setEffectSettings((current) => ({
          ...current,
          [ownerId]: mergeSettings(current[ownerId] ?? {}, patch),
        }));
      }
      if (apply) applyEffect(patch);
    }
  }

  function pointerInput(event: PointerEvent<HTMLDivElement>) {
    return getCanvasPointerInput(
      { x: event.clientX, y: event.clientY },
      previewImageWrap.current?.getBoundingClientRect(),
      document?.inspection,
      orientation,
    );
  }

  function onImagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canvasContext) return;
    canvasPointer.begin(
      event,
      pointerInput(event),
      canvasContext,
      canvasInteraction,
      spacePanActive.current,
      setIsPanning,
    );
  }

  function onImagePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!canvasContext) return;
    canvasPointer.move(
      event.pointerId,
      pointerInput(event),
      canvasContext,
      canvasInteraction,
    );
  }

  function resetCanvasInteraction() {
    canvasPointer.cancel();
    for (const tool of canvasTools.values()) tool.reset?.();
    setKeyboardCursor(null);
    setMaskDraft(null);
    setBrushCursorPoint(null);
  }

  function activateTool(tool: MaskTool) {
    if (!enabledCanvasTools.has(tool)) return;
    resetCanvasInteraction();
    dispatchWorkspace({ type: "activate-tool", tool });
    setCanvasKeyboardAnnouncement(
      `${getMaskToolView(tool).label} tool selected.`,
    );
    if (canvasContext) canvasTools.get(tool)?.activate?.(canvasContext);
    if (activeToolPanel.current) activeToolPanel.current.open = true;
  }

  function activateEffect(effectId: string) {
    const effect = getEffect(effectId);
    if (!effect) return;
    resetCanvasInteraction();
    setErrorMessage("");
    dispatchWorkspace({
      type: "activate-effect",
      effectId,
      usesMaskTools: effect.view.interaction === "mask",
    });
    if (activeToolPanel.current) activeToolPanel.current.open = true;
  }

  function changeEffectSettings(
    patch: Partial<ErasedSettings> | undefined,
    persist = true,
  ) {
    const view = activeView;
    if (!view || !patch) return;
    if (persist) canvasPointer.cancel();
    setEffectSettings((current) => ({
      ...current,
      [view.id]: mergeSettings(current[view.id] ?? {}, patch),
    }));
    if (!persist || !view.settingsStore) return;
    const merged = mergeSettings(effectSettings[view.id] ?? {}, patch);
    const saved = persistEffectSettings(view, {
      ...persistedSettings.current,
      [view.id]: merged,
    });
    if (!saved.ok) {
      setEffectSettingsError(saved.error.message);
      return;
    }
    persistedSettings.current = {
      ...persistedSettings.current,
      [view.id]: merged,
    };
    setEffectSettingsError("");
  }

  function runTopBarAction(action: EffectTopBarAction<object>) {
    resetCanvasInteraction();
    changeEffectSettings(action.patch, false);
    setErrorMessage("");
  }

  function changeComponent(index: number) {
    resetCanvasInteraction();
    setComponentIndex(index);
    setErrorMessage("");
    setEffectSettings((current) =>
      Object.fromEntries(
        EFFECT_REGISTRY.map(({ view }) => {
          const settings = current[view.id] ?? view.defaultSettings;
          return [
            view.id,
            view.resetForComponentChange
              ? view.resetForComponentChange(settings)
              : settings,
          ];
        }),
      ),
    );
  }

  /** Builds the active effect's operation, reporting why it cannot run. */
  function buildActiveOperation(
    patch: Partial<ErasedSettings> | undefined,
    mask: SpatialMask | null,
  ): JpegGlitchOperation | null {
    if (!document || !activeEffect || !activeSettings) return null;
    const { controller, view } = activeEffect;
    if (!isJpegOperationController(controller)) {
      setErrorMessage("This effect does not edit coefficient operations.");
      return null;
    }
    const built = controller.buildOperation({
      settings: mergeSettings(activeSettings, patch),
      inspection: document.inspection,
      componentIndex,
      mask: view.interaction === "mask" ? mask : null,
    });
    if (!built.ok) {
      setErrorMessage(built.error.message);
      return null;
    }
    return built.value;
  }

  function ensureCoefficientPhase(): boolean {
    if (scanCorruptionHistory.current.activeStages.length === 0) return true;
    setErrorMessage(
      "Undo Scan Corrupt before changing coefficient or DQT operations.",
    );
    return false;
  }

  function applyEffect(
    patch?: Partial<ErasedSettings>,
    mask: SpatialMask | null = activeMask,
  ): boolean {
    if (!ensureCoefficientPhase()) return false;
    const history = operationHistory.current;
    if (!history || !activeEffect) return false;
    const { controller } = activeEffect;
    if (!isJpegOperationController(controller)) return false;
    const operation = buildActiveOperation(patch, mask);
    if (!operation) return false;
    const result = controller.apply(
      history,
      operation,
      history.snapshot.inspection,
    );
    updateHistory(result);
    return result.ok;
  }

  function changeEffectAutoApply(checked: boolean) {
    if (effectAutoApplyError || !activeView) return;
    const effectId = getStorageKey(activeView);
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      setEffectAutoApplyError(
        "Effect automatic-apply settings are unavailable.",
      );
      return;
    }
    const next = { ...effectAutoApply, [effectId]: checked };
    const result = writeBrushAutoApply(storage, next);
    if (!result.ok) {
      setEffectAutoApplyError(result.error.message);
      return;
    }
    setEffectAutoApply(next);
    setEffectAutoApplyError("");
  }

  function autoApplySelectionEffect(mask: SpatialMask): boolean {
    if (
      !activeView?.autoApply ||
      !isMaskEffect ||
      !effectAutoApply[getStorageKey(activeView)]
    ) {
      return false;
    }
    return applyEffect(undefined, mask);
  }

  function markDraftPreviewStale() {
    previewAbortController.current?.abort();
    previewCoordinator.current.cancel();
    setDraftPreviewUrl(null);
    setDraftPreviewSignature("");
  }

  async function previewCurrentEffect(patch?: Partial<ErasedSettings>) {
    if (!document || !historyDocument || !activeView) return;
    if (!ensureCoefficientPhase()) return;
    const operation = buildActiveOperation(patch, activeMask);
    if (!operation) return;
    const requestSignature = getPreviewSignature(
      mergeSettings(activeSettings ?? {}, patch),
    );
    if (patch) changeEffectSettings(patch, false);

    previewAbortController.current?.abort();
    const controller = new AbortController();
    previewAbortController.current = controller;
    const coordinator = previewCoordinator.current;
    const token = coordinator.begin(historyDocument.revision);
    previewRequestSignature.current = requestSignature;
    setIsDraftPreviewing(true);
    setErrorMessage("");

    const geometry: JpegBlockGeometry = {
      width: document.inspection.width,
      height: document.inspection.height,
      components: document.inspection.components.map(
        ({ id, horizontalSampling, verticalSampling, quantizationTable }) => ({
          id,
          horizontalSampling,
          verticalSampling,
          quantizationTable,
        }),
      ),
    };

    try {
      const encoded = await encodeJpegCoefficients(
        document.originalAsset.readBytes(),
        geometry,
        [...jpegOperations, operation],
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!encoded.ok) {
        setErrorMessage(encoded.error.message);
        return;
      }
      if (
        !coordinator.isCurrent(
          token,
          operationHistory.current?.snapshot.revision ??
            historyDocument.revision,
        )
      ) {
        return;
      }

      const previewUrl = createJpegPreviewUrl(encoded.value);
      const preview = new Image();
      preview.src = previewUrl;
      try {
        await preview.decode();
      } catch {
        URL.revokeObjectURL(previewUrl);
        if (!controller.signal.aborted) {
          setErrorMessage(
            "The effect was encoded, but the browser could not decode its preview.",
          );
        }
        return;
      }
      if (
        controller.signal.aborted ||
        !coordinator.isCurrent(
          token,
          operationHistory.current?.snapshot.revision ??
            historyDocument.revision,
        )
      ) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      const expected = previewDimensions(document.inspection, orientation);
      if (
        preview.naturalWidth !== expected.width ||
        preview.naturalHeight !== expected.height
      ) {
        URL.revokeObjectURL(previewUrl);
        setErrorMessage(
          "The effect preview dimensions do not match the image.",
        );
        return;
      }
      setDraftPreviewUrl(previewUrl);
      setDraftPreviewSignature(requestSignature);
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorMessage(
          error instanceof Error
            ? `Effect preview failed: ${error.message}`
            : "Effect preview failed for an unknown reason.",
        );
      }
    } finally {
      if (previewAbortController.current === controller) {
        previewAbortController.current = null;
        setIsDraftPreviewing(false);
      }
    }
  }

  useEffect(() => {
    previewCurrentEffectRef.current = () => previewCurrentEffect();
  });

  function clearSelection() {
    resetCanvasInteraction();
    dispatchWorkspace({ type: "set-selection", selection: null });
  }

  function resetHistory() {
    if (
      !window.confirm(
        "Reset all operations and clear the current mask? Undo can restore operations, but not the cleared mask.",
      )
    ) {
      return;
    }
    scanCorruptionController.current?.abort();
    scanCorruptionController.current = null;
    scanCorruptionHistory.current.clear();
    cleanEncodedBytes.current = null;
    setScanCorruptionReports([]);
    setScanDecodeDiagnostic(null);
    setEditedBytes(null);
    setEditedPreviewUrl(null);
    setEditedPreviewError("");
    setCleanEncodedPreviewUrl(null);
    setCleanEncodedPreviewError("");
    setIsEncoding(false);
    setIsScanCorrupting(false);
    setShowCleanEncoded(false);
    const history = operationHistory.current;
    if (history) updateHistory(history.resetToOriginal());
    clearSelection();
  }

  function restoreHistoryMask(mask: SpatialMask) {
    if (
      !document ||
      mask.width !== document.inspection.width ||
      mask.height !== document.inspection.height
    ) {
      setErrorMessage("The mask snapshot does not match the current image.");
      return;
    }
    const restored = copySpatialMask(mask);
    if (!restored.ok) {
      setErrorMessage(restored.error.message);
      return;
    }
    if (!getWorkspaceOverlayVisibility(toolMode).mask) {
      activateEffect(DEFAULT_EFFECT_ID);
      dispatchWorkspace({
        type: "activate-tool",
        tool: restored.value.shapes[0]?.kind === "brush" ? "brush" : "select",
      });
    }
    resetCanvasInteraction();
    dispatchWorkspace({ type: "set-selection", selection: restored.value });
    setErrorMessage("");
  }

  const showCorruptedResult = useCallback(
    async (
      bytes: Uint8Array,
      reports: readonly ScanCorruptionReport[],
      diagnostic: ScanDecodeDiagnostic,
      signal: AbortSignal,
    ) => {
      setEditedBytes(bytes);
      setScanCorruptionReports(reports);
      setScanDecodeDiagnostic(diagnostic);
      const latestReport = reports.at(-1);
      const scanEffect = getScanCorruptionEffect();
      if (latestReport && scanEffect) {
        const settings = scanEffect.controller.settingsFromReport(latestReport);
        setEffectSettings((current) => ({
          ...current,
          [scanEffect.view.id]: settings,
        }));
      }
      setShowOriginal(false);
      setShowCleanEncoded(false);
      let previewUrl: string;
      try {
        previewUrl = createJpegPreviewUrl(bytes);
      } catch {
        setEditedPreviewUrl(null);
        setEditedPreviewError(
          "A preview could not be created for the corrupted scan. The corrupt bytes remain available to export; the clean encoded preview remains separate.",
        );
        setErrorMessage("");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        const history = operationHistory.current;
        setHistoryAvailability({
          canUndo:
            (history?.canUndo ?? false) ||
            scanCorruptionHistory.current.canUndo,
          canRedo:
            (history?.canRedo ?? false) ||
            scanCorruptionHistory.current.canRedo,
        });
        return;
      }
      let previewError = "";
      try {
        const preview = new Image();
        preview.src = previewUrl;
        await preview.decode();
        const expected = document
          ? previewDimensions(document.inspection, orientation)
          : null;
        if (
          document &&
          expected &&
          (preview.naturalWidth !== expected.width ||
            preview.naturalHeight !== expected.height)
        ) {
          previewError =
            "The corrupted JPEG preview dimensions differ from the source image.";
        }
      } catch {
        previewError =
          "The browser decoder could not render the corrupted scan. The corrupt bytes remain available to export; the clean encoded preview is shown for comparison.";
      }

      if (signal.aborted) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      if (previewError) {
        URL.revokeObjectURL(previewUrl);
        setEditedPreviewUrl(null);
        setEditedPreviewError(previewError);
      } else {
        setEditedPreviewUrl(previewUrl);
        setEditedPreviewError("");
      }
      setShowOriginal(false);
      setShowCleanEncoded(false);
      setErrorMessage("");
      setIsEncoding(false);
      setIsScanCorrupting(false);
      scanCorruptionController.current = null;
      const history = operationHistory.current;
      setHistoryAvailability({
        canUndo:
          (history?.canUndo ?? false) || scanCorruptionHistory.current.canUndo,
        canRedo:
          (history?.canRedo ?? false) || scanCorruptionHistory.current.canRedo,
      });
    },
    [document, orientation],
  );

  const replayScanStages = useCallback(
    async (
      stages: readonly ScanCorruptionParameters[],
      commitHistory: () => boolean,
    ) => {
      if (!document) {
        setErrorMessage("Open a JPEG before using Scan Corrupt.");
        return;
      }
      let cleanBytes = cleanEncodedBytes.current;
      if (!cleanBytes && jpegOperations.length > 0) {
        setErrorMessage(
          "Wait for the clean JPEG encoding before using Scan Corrupt.",
        );
        return;
      }
      if (stages.length === 0) {
        if (!cleanBytes) {
          setErrorMessage("The clean encoded JPEG is unavailable for undo.");
          return;
        }
        if (!commitHistory()) {
          setErrorMessage("The Scan Corrupt history could not be updated.");
          return;
        }
        const restoredBytes = cleanBytes.slice();
        setEditedBytes(restoredBytes);
        setScanCorruptionReports([]);
        setScanDecodeDiagnostic(null);
        setEditedPreviewError(cleanEncodedPreviewErrorRef.current);
        if (cleanEncodedPreviewErrorRef.current) {
          setEditedPreviewUrl(null);
        } else {
          try {
            setEditedPreviewUrl(createJpegPreviewUrl(restoredBytes));
          } catch {
            setEditedPreviewUrl(null);
            setEditedPreviewError(
              "The clean encoded JPEG remains available to export, but its preview could not be created.",
            );
          }
        }
        setShowOriginal(false);
        setShowCleanEncoded(false);
        setErrorMessage("");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        const history = operationHistory.current;
        setHistoryAvailability({
          canUndo:
            (history?.canUndo ?? false) ||
            scanCorruptionHistory.current.canUndo,
          canRedo:
            (history?.canRedo ?? false) ||
            scanCorruptionHistory.current.canRedo,
        });
        return;
      }

      const controller = new AbortController();
      scanCorruptionController.current?.abort();
      scanCorruptionController.current = controller;
      setIsEncoding(true);
      setIsScanCorrupting(true);
      setErrorMessage("");
      if (!cleanBytes) {
        const encoded = await encodeJpegCoefficients(
          document.originalAsset.readBytes(),
          {
            width: document.inspection.width,
            height: document.inspection.height,
            components: document.inspection.components.map(
              ({
                id,
                horizontalSampling,
                verticalSampling,
                quantizationTable,
              }) => ({
                id,
                horizontalSampling,
                verticalSampling,
                quantizationTable,
              }),
            ),
          },
          [],
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!encoded.ok) {
          setErrorMessage(encoded.error.message);
          setIsEncoding(false);
          setIsScanCorrupting(false);
          scanCorruptionController.current = null;
          return;
        }

        let previewUrl: string | null = null;
        let previewError = "";
        try {
          previewUrl = createJpegPreviewUrl(encoded.value);
          const preview = new Image();
          preview.src = previewUrl;
          await preview.decode();
          const expected = previewDimensions(document.inspection, orientation);
          if (
            preview.naturalWidth !== expected.width ||
            preview.naturalHeight !== expected.height
          ) {
            previewError =
              "The clean encoded JPEG preview dimensions differ from the source image.";
          }
        } catch {
          previewError =
            "The clean encoded JPEG could not be previewed; its bytes remain available.";
        }
        if (controller.signal.aborted) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          return;
        }
        if (previewError && previewUrl) {
          URL.revokeObjectURL(previewUrl);
          previewUrl = null;
        }
        cleanBytes = encoded.value;
        cleanEncodedBytes.current = cleanBytes;
        cleanEncodedPreviewErrorRef.current = previewError;
        setCleanEncodedPreviewUrl(previewUrl);
        setCleanEncodedPreviewError(previewError);
      }
      const scanController = getScanCorruptionEffect()?.controller;
      if (!scanController) {
        setErrorMessage("The Scan Corrupt controller is unavailable.");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        return;
      }
      const corrupted = await scanController.execute_corrupt(
        cleanBytes,
        stages,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!corrupted.ok) {
        setErrorMessage(corrupted.error.message);
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        return;
      }
      if (!commitHistory()) {
        setErrorMessage("The Scan Corrupt history could not be updated.");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        return;
      }
      await showCorruptedResult(
        corrupted.value.bytes,
        corrupted.value.reports,
        corrupted.value.diagnostic,
        controller.signal,
      );
    },
    [document, jpegOperations, orientation, showCorruptedResult],
  );

  useEffect(() => {
    const stages = pendingProjectStages.current;
    if (
      !document ||
      !stages ||
      projectStagesReplayStarted.current ||
      (jpegOperations.length > 0 && !editedBytes)
    ) {
      return;
    }

    projectStagesReplayStarted.current = true;
    void replayScanStages(stages, () => {
      scanCorruptionHistory.current.clear();
      for (const stage of stages) {
        if (!scanCorruptionHistory.current.record(stage).ok) {
          scanCorruptionHistory.current.clear();
          return false;
        }
      }
      pendingProjectStages.current = null;
      return true;
    });
  }, [document, editedBytes, jpegOperations.length, replayScanStages]);

  function applyScanCorruption(settings: object) {
    const scan = getScanCorruptionEffect();
    if (!scan) return;
    const history = scanCorruptionHistory.current;
    if (history.activeStages.length >= MAX_SCAN_CORRUPTION_STAGES) {
      setErrorMessage(
        `A maximum of ${MAX_SCAN_CORRUPTION_STAGES} entropy-corruption stages can be stacked.`,
      );
      return;
    }
    const parameters = scan.controller.toParameters(settings);
    const stages = [...history.activeStages, parameters];
    void replayScanStages(stages, () => history.record(parameters).ok);
  }

  function updateLastScanCorruption(settings: object) {
    const scan = getScanCorruptionEffect();
    const history = scanCorruptionHistory.current;
    if (!scan || history.activeStages.length === 0) return;
    const parameters = scan.controller.toParameters(settings);
    const stages = [...history.activeStages.slice(0, -1), parameters];
    void replayScanStages(stages, () => history.replaceLast(parameters).ok);
  }

  function undoScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (!history.canUndo) return false;
    void replayScanStages(history.undoTarget, () => history.commitUndo());
    return true;
  }

  function redoScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (!history.canRedo) return false;
    void replayScanStages(history.redoTarget, () => history.commitRedo());
    return true;
  }

  function cancelScanCorruption() {
    const controller = scanCorruptionController.current;
    if (!controller) return;
    controller.abort();
    scanCorruptionController.current = null;
    setIsScanCorrupting(false);
    setIsEncoding(false);
    setErrorMessage(
      "Scan corruption was cancelled; the prior JPEG bytes are unchanged.",
    );
  }

  function handleUndo() {
    if (undoScanCorruption()) return;
    const history = operationHistory.current;
    if (history) updateHistory(history.undo());
  }

  function handleRedo() {
    if (redoScanCorruption()) return;
    if (scanCorruptionHistory.current.activeStages.length > 0) return;
    const history = operationHistory.current;
    if (history) updateHistory(history.redo());
  }

  async function downloadEditedJpeg() {
    if (!editedBytes || !document) return;
    let exportBytes = editedBytes;
    // Scan Corrupt output is a baseline byte experiment, so progressive
    // export re-encodes the same operations from the original coefficients.
    const effectiveMode =
      scanCorruptionReports.length > 0 ? "baseline" : exportMode;
    if (effectiveMode === "progressive") {
      setIsExporting(true);
      setErrorMessage("");
      const encoded = await encodeJpegCoefficients(
        document.originalAsset.readBytes(),
        {
          width: document.inspection.width,
          height: document.inspection.height,
          components: document.inspection.components.map(
            ({
              id,
              horizontalSampling,
              verticalSampling,
              quantizationTable,
            }) => ({
              id,
              horizontalSampling,
              verticalSampling,
              quantizationTable,
            }),
          ),
        },
        jpegOperations,
        undefined,
        { mode: "progressive" },
      );
      setIsExporting(false);
      if (!encoded.ok) {
        setErrorMessage(encoded.error.message);
        return;
      }
      exportBytes = encoded.value;
    }
    const output = new ArrayBuffer(exportBytes.byteLength);
    new Uint8Array(output).set(exportBytes);
    const url = URL.createObjectURL(new Blob([output], { type: "image/jpeg" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.originalAsset.fileName.replace(/\.[^.]+$/, "")}.edited${effectiveMode === "progressive" ? ".progressive" : ""}.jpg`;
    link.hidden = true;
    window.document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadProjectFile() {
    if (!document || !historyDocument) return;
    setIsSavingProject(true);
    setErrorMessage("");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      const result = await createJgeProjectFile(
        {
          source: {
            fileName: document.originalAsset.fileName,
            sha256: document.originalAsset.sha256,
            bytes: document.originalAsset.readBytes(),
          },
          operations: historyDocument.operations,
          draftMask: globalSelectionMask,
          scanCorruptionStages:
            scanCorruptionHistory.current.activeStages.length > 0
              ? scanCorruptionHistory.current.activeStages
              : (pendingProjectStages.current ?? []),
        },
        { application: APPLICATION_VERSION, codec: JPEG_CODEC_VERSION },
      );
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      const baseName =
        document.originalAsset.fileName
          .replace(/\.[^.]+$/, "")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 100) || "project";
      const url = URL.createObjectURL(result.value);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${baseName}.jpglitch`;
      link.hidden = true;
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsSavingProject(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void loadFile(file);
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1) {
      setErrorMessage("Open one JPEG at a time.");
      return;
    }
    if (files[0]) void loadFile(files[0]);
  }

  const overlayVisibility = getWorkspaceOverlayVisibility(toolMode);
  const activeMaskForOverlay = overlayVisibility.mask ? activeMask : null;
  const visibleSelection = overlayVisibility.mask
    ? maskDraft?.kind === "rectangle"
      ? maskDraft.selection
      : getRectangleSelection(activeMaskForOverlay)
    : null;
  const canvasImageContext: MaskToolContext | null = document
    ? {
        inspection: document.inspection,
        componentIndex,
        grid: maskGrid,
        brushSize,
      }
    : null;
  const canvasContext: CanvasContext | null = canvasImageContext
    ? {
        ...canvasImageContext,
        orientation,
        keyboardCursor,
        publish: publishCanvasFeedback,
        cancelGesture: () => canvasPointer.cancel(),
      }
    : null;

  function resolveCanvasInteraction(): CanvasInteraction | undefined {
    if (maskToolId) return canvasTools.get(maskToolId);
    if (
      !canvasImageContext ||
      !activeEffect ||
      !activeSettings ||
      !isJpegOperationController(activeEffect.controller)
    ) {
      return undefined;
    }
    const { controller, view } = activeEffect;
    if (!controller.gestures) return undefined;
    return new EffectCanvasInteraction(
      controller.gestures,
      {
        settings: activeSettings,
        inspection: canvasImageContext.inspection,
        componentIndex,
      },
      view.id,
    );
  }

  const canvasInteraction = resolveCanvasInteraction();
  const gestureOverlay =
    canvasImageContext && canvasInteraction?.getOverlay?.(canvasImageContext);
  const canvasHint =
    canvasImageContext && canvasInteraction?.getHint(canvasImageContext);
  const activeToolLabel = activeView?.label ?? "Effect settings";
  const toolbarTools = activeView?.toolbar.tools ?? [];
  const enabledCanvasTools: ReadonlySet<MaskTool> = isMaskEffect
    ? new Set(toolbarTools)
    : NO_TOOLS;
  const needsCanvasMask = !activeMask && isMaskEffect;
  const suggestedCanvasTools: ReadonlySet<MaskTool> = needsCanvasMask
    ? new Set(toolbarTools)
    : NO_TOOLS;
  const topBarActions =
    activeView?.getTopBarActions?.(
      activeSettings ?? activeView.defaultSettings,
    ) ?? [];
  const hasScanCorruption = scanCorruptionReports.length > 0;
  const canApplyScanCorruption =
    document !== null && (jpegOperations.length === 0 || editedBytes !== null);
  const previewUrlToDisplay = showOriginal
    ? document?.previewUrl
    : showCleanEncoded
      ? cleanEncodedPreviewUrl
      : (draftPreviewUrl ??
        editedPreviewUrl ??
        (hasScanCorruption ? cleanEncodedPreviewUrl : document?.previewUrl));

  useEffect(() => {
    function onWorkspaceKeyDown(event: KeyboardEvent) {
      if (saveDialogRef.current?.open) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"))
      ) {
        return;
      }
      if (event.code === "Space" && document) {
        event.preventDefault();
        spacePanActive.current = true;
        return;
      }

      if (
        canvasContext &&
        canvasInteraction?.handleKey?.(
          {
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            canvasFocused: target === previewImageWrap.current,
            pointerActive: canvasPointer.isActive,
          },
          canvasContext,
        )
      ) {
        event.preventDefault();
        return;
      }
      const shortcut = getWorkspaceShortcut(event);
      if (shortcut === "select-all") return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey && document) {
        const key = event.key.toUpperCase();
        const action = topBarActions.find(
          ({ shortcut: actionShortcut, disabled }) =>
            actionShortcut === key && !disabled,
        );
        if (action) {
          event.preventDefault();
          runTopBarAction(action);
          return;
        }
        const tool = toolbarTools.find(
          (id) =>
            enabledCanvasTools.has(id) && getMaskToolView(id).shortcut === key,
        );
        if (!tool) return;
        event.preventDefault();
        activateTool(tool);
        return;
      }
      if (!shortcut) return;
      const targetSelector = {
        undo: 'button[aria-label="Undo"]',
        redo: 'button[aria-label="Redo"]',
        save: 'button[aria-label="Save"]',
        "open-file": 'button[aria-label="Open file"]',
      }[shortcut];
      const button =
        window.document.querySelector<HTMLButtonElement>(targetSelector);
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    }

    function onWorkspaceKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") spacePanActive.current = false;
    }

    function onWorkspaceBlur() {
      spacePanActive.current = false;
      resetCanvasInteraction();
      setCanvasHasKeyboardFocus(false);
    }

    window.addEventListener("blur", onWorkspaceBlur);
    window.addEventListener("keydown", onWorkspaceKeyDown);
    window.addEventListener("keyup", onWorkspaceKeyUp);
    return () => {
      window.removeEventListener("blur", onWorkspaceBlur);
      window.removeEventListener("keydown", onWorkspaceKeyDown);
      window.removeEventListener("keyup", onWorkspaceKeyUp);
    };
  });

  const [editorBridge] = useState(() => new EditorBridge());
  useEffect(() => {
    editorBridge.update({
      changeComponent,
      changeAutoApply: changeEffectAutoApply,
      setError: (message) => {
        setErrorMessage(message);
      },
      apply: (patch) => {
        applyEffect(patch);
      },
      preview: (patch) => {
        void previewCurrentEffect(patch);
      },
      discardPreview: markDraftPreviewStale,
      applyScan: applyScanCorruption,
      updateLastScan: updateLastScanCorruption,
      cancelScan: cancelScanCorruption,
    });
  });

  const editor: EffectEditor<ErasedSettings> | null = document
    ? {
        assetKey: document.originalAsset.sha256,
        inspection: document.inspection,
        operations: jpegOperations,
        componentLabels,
        colorModel,
        imageUrl: previewUrlToDisplay ?? null,
        componentIndex,
        hasMask: activeMask !== null,
        isEncoding,
        isPreviewing: isDraftPreviewing,
        hasScanCorruption,
        autoApply: activeView
          ? !!effectAutoApply[getStorageKey(activeView)]
          : false,
        autoApplyDisabled: !!effectAutoApplyError,
        scanCorruption: {
          canApply: canApplyScanCorruption,
          isCorrupting: isScanCorrupting,
          hasScanCorruption,
          hasJpegOperations: jpegOperations.length > 0,
          reports: scanCorruptionReports,
          diagnostic: scanDecodeDiagnostic,
          previewError: editedPreviewError,
          apply: editorBridge.applyScan,
          updateLastStage: editorBridge.updateLastScan,
          cancel: editorBridge.cancelScan,
        },
        onChangeComponent: editorBridge.changeComponent,
        onChangeAutoApply: editorBridge.changeAutoApply,
        onError: editorBridge.setError,
        apply: editorBridge.apply,
        preview: editorBridge.preview,
        discardPreview: editorBridge.discardPreview,
      }
    : null;

  return (
    <main className={`workspace ${document ? "has-document" : ""}`}>
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="JPEG Glitch Editor home"
        >
          <span className="brand-mark" aria-hidden="true">
            J
          </span>
          <span>JPEG Glitch Editor</span>
        </a>
        <div className="topbar-actions">
          {document && (
            <span
              className="active-file"
              title={document.originalAsset.fileName}
            >
              {document.originalAsset.fileName}
            </span>
          )}
          <div className="history-toolbar" aria-label="Operation history">
            <button
              className="history-toolbar-button"
              type="button"
              onClick={handleUndo}
              disabled={!historyAvailability.canUndo || isEncoding}
              aria-label="Undo"
              aria-keyshortcuts="Control+Z Meta+Z"
              title="Undo"
            >
              ↶
            </button>
            <button
              className="history-toolbar-button"
              type="button"
              onClick={handleRedo}
              disabled={!historyAvailability.canRedo || isEncoding}
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
              title="Redo"
            >
              ↷
            </button>
          </div>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,.jpg,.jpeg,.jpglitch,application/vnd.jpeg-glitch-editor.project+json"
            aria-label="Choose a JPEG or editor project file"
            tabIndex={-1}
            onChange={onFileChange}
          />
          <button
            className="open-button"
            type="button"
            aria-label="Open file"
            onClick={() => fileInput.current?.click()}
            disabled={isLoading}
            aria-keyshortcuts="Control+O Meta+O"
            title="Open a JPEG or .jpglitch project (Ctrl/⌘+O)"
          >
            {isLoading ? loadingMessage : "Open file"}
          </button>
          {document && (
            <button
              className="open-button"
              type="button"
              aria-label="Save"
              onClick={() => setIsSaveDialogOpen(true)}
              disabled={isSavingProject || isLoading}
              aria-keyshortcuts="Control+S Meta+S"
              title="Save as JPEG or .jpglitch (Ctrl/⌘+S)"
            >
              {isSavingProject ? "Saving…" : "Save"}
            </button>
          )}
          {document && (
            <button
              className="export-button"
              type="button"
              onClick={downloadEditedJpeg}
              disabled={!editedBytes || isEncoding}
              title={
                hasScanCorruption
                  ? "Download the entropy-corrupted JPEG bytes; the original remains unchanged"
                  : "Download the encoded JPEG experiment; the original is unchanged"
              }
            >
              {isEncoding
                ? isScanCorrupting
                  ? "Corrupting…"
                  : "Encoding…"
                : "Export JPEG"}
            </button>
          )}
        </div>
      </header>

      {document && (
        <dialog
          ref={saveDialogRef}
          className="save-dialog"
          aria-labelledby="save-dialog-title"
          aria-describedby="save-dialog-description"
          onCancel={(event) => {
            event.preventDefault();
            setIsSaveDialogOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setIsSaveDialogOpen(false);
          }}
          onClose={() => setIsSaveDialogOpen(false)}
        >
          <h2 id="save-dialog-title">Choose what to save</h2>
          <p id="save-dialog-description">
            Export the current JPEG experiment, or save a .jpglitch project with
            the exact original JPEG and editable operations. The original file
            is never overwritten.
          </p>
          <label className="save-dialog-mode">
            JPEG output mode
            <select
              value={scanCorruptionReports.length > 0 ? "baseline" : exportMode}
              disabled={scanCorruptionReports.length > 0}
              onChange={(event) =>
                setExportMode(
                  event.target.value === "progressive"
                    ? "progressive"
                    : "baseline",
                )
              }
            >
              <option value="baseline">Baseline (sequential)</option>
              <option value="progressive">Progressive</option>
            </select>
          </label>
          <p className="save-dialog-note">
            {scanCorruptionReports.length > 0
              ? "Scan Corrupt results are baseline byte experiments and are always saved as baseline."
              : "Coefficients are written as they are; only the scan layout changes, with no RGB round trip. Progressive output does not depend on the source JPEG type."}
          </p>
          <div className="save-dialog-actions">
            <button
              className="open-button"
              type="button"
              autoFocus
              disabled={!editedBytes || isEncoding || isExporting}
              title={
                editedBytes
                  ? "Export the current JPEG experiment"
                  : "Apply a JPEG operation before exporting an image"
              }
              onClick={() => {
                setIsSaveDialogOpen(false);
                void downloadEditedJpeg();
              }}
            >
              Save image (.jpg)
            </button>
            <button
              className="open-button"
              type="button"
              disabled={isSavingProject || isLoading}
              onClick={() => {
                setIsSaveDialogOpen(false);
                void downloadProjectFile();
              }}
            >
              Save editable project (.jpglitch)
            </button>
            <button
              className="tool-toggle"
              type="button"
              onClick={() => setIsSaveDialogOpen(false)}
            >
              Cancel
            </button>
          </div>
        </dialog>
      )}

      <section
        className={`editor ${isDragging ? "is-dragging" : ""}`}
        aria-label="JPEG workspace"
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {document && (
          <EffectCatalogPanel
            groups={EFFECT_MENU}
            registry={EFFECT_REGISTRY}
            selectedEffectId={activeView?.id ?? null}
            hasActiveMask={activeMask !== null}
            onSelectEffect={activateEffect}
          />
        )}
        <div className="canvas-column">
          <div className="canvas">
            {visibleErrorMessage && (
              <div className="workspace-error-toast" role="alert">
                <span className="error-icon" aria-hidden="true">
                  !
                </span>
                <span className="workspace-error-message">
                  {visibleErrorMessage}
                </span>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => {
                    setDismissedToastMessage(visibleErrorMessage);
                    setErrorMessage("");
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {!document ? (
              <div className="welcome">
                <div className="eyebrow">JPEG STRUCTURE · CREATIVE CONTROL</div>
                <h1>Make room for happy accidents.</h1>
                <p>
                  Inspect JPEG structure and quantized DCT coefficients locally.
                  The original file stays untouched and its pixel preview
                  remains separate.
                </p>
                <button
                  className="welcome-button"
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={isLoading}
                >
                  Choose a JPEG
                  <span aria-hidden="true">↗</span>
                </button>
                <div className="milestone-note">
                  <span className="note-index">03</span>
                  <span>
                    Drop a JPEG to inspect it, select a region, and apply
                    reversible JPEG effects.
                  </span>
                </div>
                <nav className="contact-links" aria-label="Contact">
                  <a href="https://instagram.com/sahdoum">Instagram</a>
                  <a href="https://t.me/achekhonte">Telegram</a>
                  <a href="https://github.com/sahdoum">GitHub</a>
                </nav>
                {import.meta.env.VITE_GTM_CONTAINER_ID && (
                  <p className="analytics-notice">
                    This site uses Google Tag Manager for visit analytics.
                    Google receives visit data; images are processed locally.{" "}
                    <a href="https://policies.google.com/privacy">
                      Google privacy policy
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <div className="preview-workspace">
                <div className="preview-toolbar">
                  <CanvasToolbar
                    tools={toolbarTools}
                    activeTool={toolMode === "effect" ? null : toolMode}
                    enabledTools={enabledCanvasTools}
                    suggestedTools={suggestedCanvasTools}
                    showSnapGrid={activeView?.toolbar.showSnapGrid ?? false}
                    actions={topBarActions}
                    onAction={runTopBarAction}
                    controls={{ brushSize, onChangeBrushSize: setBrushSize }}
                    maskGrid={maskGrid}
                    onChangeMaskGrid={(grid) => {
                      resetCanvasInteraction();
                      setMaskGrid(grid);
                    }}
                    onSelectTool={activateTool}
                  />
                  {draftPreviewUrl && !showOriginal && !showCleanEncoded && (
                    <span
                      className={`preview-state ${isDraftPreviewStale ? "is-stale" : ""}`}
                      role="status"
                      title={
                        isDraftPreviewStale
                          ? "Parameters changed since this temporary preview."
                          : "Temporary JPEG-encoded preview; History is unchanged."
                      }
                    >
                      {isDraftPreviewStale ? "Stale" : "Preview"}
                    </span>
                  )}
                  <div className="overlay-controls">
                    <button
                      className="tool-toggle"
                      type="button"
                      onClick={() =>
                        setZoom((current) => Math.max(0.25, current - 0.25))
                      }
                      aria-label="Zoom out"
                    >
                      −
                    </button>
                    <span className="zoom-readout">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      className="tool-toggle"
                      type="button"
                      onClick={() =>
                        setZoom((current) => Math.min(4, current + 0.25))
                      }
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                    <button
                      className="tool-toggle"
                      type="button"
                      onClick={() => setZoom(1)}
                    >
                      Fit
                    </button>
                    {hasScanCorruption && cleanEncodedPreviewUrl && (
                      <button
                        className="tool-toggle"
                        type="button"
                        aria-pressed={showCleanEncoded}
                        onClick={() => {
                          setShowOriginal(false);
                          setShowCleanEncoded((current) => !current);
                        }}
                      >
                        {showCleanEncoded
                          ? "Show corrupted"
                          : "Show clean encoded"}
                      </button>
                    )}
                    {editedBytes && (
                      <button
                        className="tool-toggle"
                        type="button"
                        aria-pressed={showOriginal}
                        onClick={() => {
                          setShowCleanEncoded(false);
                          setShowOriginal((current) => !current);
                        }}
                      >
                        {showOriginal ? "Show edited" : "Show original"}
                      </button>
                    )}
                    {isEncoding && (
                      <span className="encoding-indicator" role="status">
                        {isScanCorrupting ? "Corrupting scan…" : "Re-encoding…"}
                      </span>
                    )}
                    <div className="overlay-checkboxes">
                      <label>
                        <input
                          type="checkbox"
                          checked={showBlocks}
                          onChange={(event) =>
                            setShowBlocks(event.currentTarget.checked)
                          }
                        />
                        <span>8×8 DCT</span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showMcus}
                          onChange={(event) =>
                            setShowMcus(event.currentTarget.checked)
                          }
                        />
                        <span>MCUs</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div
                  className="image-stage"
                  ref={imageStage}
                  onPointerDown={onImagePointerDown}
                  onPointerMove={onImagePointerMove}
                  onPointerUp={(event) =>
                    canvasPointer.end(event.pointerId, pointerInput(event))
                  }
                  onPointerLeave={(event) => {
                    if (canvasContext)
                      canvasPointer.leave(
                        event.pointerId,
                        canvasContext,
                        canvasInteraction,
                      );
                  }}
                  onPointerCancel={(event) =>
                    canvasPointer.cancel(event.pointerId)
                  }
                  onLostPointerCapture={(event) =>
                    canvasPointer.cancel(event.pointerId)
                  }
                >
                  <div
                    className={`preview-image-wrap ${maskToolView?.canvasClass ?? canvasInteraction?.canvasClass ?? ""} ${isPanning ? "is-panning" : ""}`}
                    style={{ transform: `scale(${zoom})` }}
                    role="group"
                    tabIndex={0}
                    aria-label="JPEG image canvas"
                    aria-describedby={
                      canvasHint ? "canvas-tool-help" : undefined
                    }
                    aria-keyshortcuts={maskToolView?.keyShortcuts}
                    onFocus={() => {
                      setCanvasHasKeyboardFocus(true);
                      if (canvasContext)
                        canvasInteraction?.focus?.(canvasContext);
                    }}
                    onBlur={() => setCanvasHasKeyboardFocus(false)}
                    ref={previewImageWrap}
                  >
                    {previewUrlToDisplay ? (
                      <img
                        className="preview-image"
                        src={previewUrlToDisplay}
                        alt={`${showOriginal ? "Original" : showCleanEncoded ? "Clean encoded" : draftPreviewUrl ? "Uncommitted effect preview" : hasScanCorruption ? "Entropy-corrupted" : "Re-encoded"} JPEG preview of ${document.originalAsset.fileName}`}
                      />
                    ) : (
                      <div className="scan-preview-unavailable" role="status">
                        {cleanEncodedPreviewError ||
                          editedPreviewError ||
                          "No decoded preview is available. The clean and corrupted JPEG bytes remain separate from the original."}
                      </div>
                    )}
                    <ImageOverlays
                      inspection={document.inspection}
                      orientation={orientation}
                      showBlocks={showBlocks}
                      showMcus={showMcus}
                      selection={visibleSelection}
                      mask={activeMaskForOverlay}
                      brushDraft={
                        maskDraft?.kind === "brush" ? maskDraft : null
                      }
                      brushCursorPoint={brushCursorPoint}
                      brushRadius={
                        maskDraft?.kind === "brush"
                          ? maskDraft.radius
                          : brushSize / 2
                      }
                      componentId={
                        document.inspection.components[componentIndex]?.id ?? -1
                      }
                      keyboardCursor={
                        canvasHasKeyboardFocus ? keyboardCursor : null
                      }
                      gestureSource={gestureOverlay?.source ?? null}
                      gestureSourceInvalid={
                        gestureOverlay?.sourceInvalid ?? false
                      }
                      gestureDestination={gestureOverlay?.destination ?? null}
                      gestureDestinationInvalid={
                        gestureOverlay?.destinationInvalid ?? false
                      }
                    />
                  </div>
                </div>
                {canvasHint && (
                  <p id="canvas-tool-help" className="canvas-keyboard-help">
                    {canvasHint.text} {canvasHint.keyboard}
                  </p>
                )}
                <span
                  className="visually-hidden"
                  role="status"
                  aria-live="polite"
                >
                  {canvasKeyboardAnnouncement}
                </span>
              </div>
            )}
            {isDragging && (
              <div className="drop-overlay" aria-hidden="true">
                <span>Drop one JPEG to inspect</span>
              </div>
            )}
          </div>
        </div>

        <aside className="side-panel">
          <div className="side-panel-content">
            {projectNotice && (
              <p className="project-notice" role="status">
                {projectNotice}
              </p>
            )}
            {document && editor ? (
              <>
                <CollapsibleSection
                  id="active-tool"
                  title={`${activeToolLabel} settings`}
                  kicker="ACTIVE TOOL"
                  className="active-tool-panel"
                  detailsRef={activeToolPanel}
                >
                  {activeView && activeSettings ? (
                    <activeView.Panel
                      settings={activeSettings}
                      editor={editor}
                      onChangeSettings={changeEffectSettings}
                    />
                  ) : (
                    <p role="alert">
                      The selected effect settings are unavailable.
                    </p>
                  )}
                </CollapsibleSection>
                <CollapsibleSection
                  id="history"
                  title="History"
                  kicker="NON-DESTRUCTIVE OPERATIONS"
                  count={
                    (historyDocument?.operations.length ?? 0) +
                    scanCorruptionReports.length
                  }
                  className="history-panel"
                  initiallyOpen={false}
                >
                  <OperationHistoryPanel
                    operations={historyDocument?.operations ?? []}
                    scanCorruptionReports={scanCorruptionReports}
                    hasScanCorruption={hasScanCorruption}
                    onSetEnabled={(operationId, enabled) =>
                      mutateHistory((history) =>
                        history.setEnabled(operationId, enabled),
                      )
                    }
                    onMove={(operationId, index) =>
                      mutateHistory((history) =>
                        history.move(operationId, index),
                      )
                    }
                    onDelete={(operationId) =>
                      mutateHistory((history) => history.delete(operationId))
                    }
                    onRestoreMask={restoreHistoryMask}
                    onReset={resetHistory}
                  />
                </CollapsibleSection>
              </>
            ) : (
              <div className="inspector-empty">
                <span className="empty-index">JPEG GLITCH EDITOR</span>
                <h2>Open a JPEG to begin</h2>
                <p>
                  Choose or drop a JPEG to select an effect and view its
                  settings. The original bytes remain unchanged.
                </p>
                {errorMessage && (
                  <p className="support-note">
                    Supported for coefficient inspection: 8-bit baseline
                    sequential (single interleaved scan) or progressive Huffman
                    JPEG, grayscale or three-component.
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
