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
  createJpegPreviewUrl,
  decodeJpegFrame,
  encodeJpegFrame,
  jpegGeometry,
  type EncodedJpegFrame,
} from "./application/jpeg-result";
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
import { readJpegOrientation } from "./application/preview-orientation";
import {
  createJgeProjectFile,
  readJgeProjectFile,
  type JgeProjectData,
  type JgeProjectSaveData,
} from "./project/project-file";
import { projectEditsKey } from "./project/project-edits";
import {
  type JpegBlockCoordinate,
  type JpegSelectionGrid,
} from "./jpeg/block-geometry";
import { copySpatialMask, type SpatialMask } from "./document/masks";
import type { ProjectDocument } from "./document/model";
import { OperationHistory } from "./operations/history";
import type { JpegGlitchOperation } from "./operations/jpeg-glitch";
import { EditorBridge } from "./features/effects/editor-bridge";
import { PreviewCoordinator } from "./application/preview-coordinator";
import {
  areaToolForMask,
  initialWorkspaceState,
  getWorkspaceOverlayVisibility,
  getWorkspaceShortcut,
  workspaceReducer,
  type MaskTool,
} from "./ui/workspace-state";
import { getRectangleSelection } from "./ui/selection-overlay";
import {
  ScanCorruptionHistory,
  type CorruptedEncodedJpeg,
} from "./application/scan-corruption";
import { downloadFileUrl } from "./ui/download-file";
import {
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
  type ScanCorruptionReport,
} from "./jpeg/scan-corruption";
import type { ScanDecodeDiagnostic } from "./jpeg/scan-corruption-worker-protocol";
import type {
  EffectEditor,
  EffectTopBarAction,
} from "./features/effects/types";
import { isJpegOperationController } from "./features/effects/types";
import { EffectCatalogPanel } from "./ui/effect-catalog-panel";
import { examplePhotoUrl } from "./ui/example-photo";
import { WelcomeScreen } from "./ui/welcome-screen";
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
import { ImageOverlays } from "./ui/image-overlays";
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
const PHOTO_TYPES = "image/jpeg,.jpg,.jpeg";
const PROJECT_TYPES =
  ".jpglitch,application/vnd.jpeg-glitch-editor.project+json";

interface RequestedFile {
  readonly file: File;
  readonly example?: boolean;
}

interface FileOpenError {
  readonly message: string;
  readonly detail?: string;
}

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

interface DraftPreview {
  readonly signature: string;
  readonly operation: JpegGlitchOperation;
  readonly frame: EncodedJpegFrame;
}

function App() {
  const [document, setDocument] = useState<ImportedJpeg | null>(null);
  const [historyDocument, setHistoryDocument] =
    useState<ProjectDocument<JpegEditableState> | null>(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [editedBytes, setEditedBytes] = useState<Uint8Array | null>(null);
  const [editedPreviewError, setEditedPreviewError] = useState("");
  const [draftPreview, setDraftPreview] = useState<DraftPreview | null>(null);
  const [draftRequest, setDraftRequest] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [effectApplied, setEffectApplied] = useState(false);
  const [applying, setApplying] = useState<
    "effect" | "stroke" | "selection" | null
  >(null);
  const [wholeImageMask, setWholeImageMask] = useState<SpatialMask | null>(
    null,
  );
  const [documentSession, setDocumentSession] = useState(0);
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
  const [isExportOptionsOpen, setIsExportOptionsOpen] = useState(false);
  const [requestedFile, setRequestedFile] = useState<RequestedFile | null>(
    null,
  );
  const [openError, setOpenError] = useState<FileOpenError | null>(null);
  const [examplePhoto, setExamplePhoto] = useState(false);
  const [isFetchingExample, setIsFetchingExample] = useState(false);
  const [operationEffectIds, setOperationEffectIds] = useState<
    Readonly<Record<string, string>>
  >({});
  const [showHistory, setShowHistory] = useState(false);
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
  const exportOptionsRef = useRef<HTMLDialogElement>(null);
  const replaceDialogRef = useRef<HTMLDialogElement>(null);
  const fileMenu = useRef<HTMLDetailsElement>(null);
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
  const [effectAutoApply, setEffectAutoApply] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [zoom, setZoom] = useState(1);
  const [maskDraft, setMaskDraft] = useState<MaskDraft | null>(null);
  const [canvasError, setCanvasError] = useState("");
  const [brushCursorPoint, setBrushCursorPoint] = useState<ImagePoint | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const previewCoordinator = useRef(new PreviewCoordinator());
  const previewAbortController = useRef<AbortController | null>(null);
  const applyController = useRef<AbortController | null>(null);
  const renderedOperations = useRef<readonly JpegGlitchOperation[] | null>(
    null,
  );
  const previewCurrentEffectRef = useRef<(() => Promise<void>) | null>(null);
  const dragDepth = useRef(0);
  const importController = useRef<AbortController | null>(null);
  const operationHistory = useRef<OperationHistory<JpegEditableState> | null>(
    null,
  );
  const scanCorruptionHistory = useRef(new ScanCorruptionHistory());
  const cleanEncodedBytes = useRef<Uint8Array | null>(null);
  const scanCorruptionController = useRef<AbortController | null>(null);
  const lastSavedProject = useRef("");
  const savingProject = useRef(false);
  const [canvasPointer] = useState(() => new CanvasPointer());
  const [canvasTools] = useState(createCanvasToolControllers);
  const spacePanActive = useRef(false);
  const imageStage = useRef<HTMLDivElement>(null);
  const previewImageWrap = useRef<HTMLDivElement>(null);
  const jpegOperations =
    historyDocument?.currentState.jpegOperations ?? EMPTY_JPEG_OPERATIONS;
  const activeEffect = getEffect(activeEffectId ?? DEFAULT_EFFECT_ID);
  const activeView = activeEffect?.view;
  const activeSettings = activeView ? effectSettings[activeView.id] : undefined;
  const isMaskEffect = activeView?.interaction === "mask";
  const activeMask = isMaskEffect ? globalSelectionMask : null;
  const autoApplyKey =
    activeView && (toolMode === "brush" || toolMode === "select")
      ? `${getStorageKey(activeView)}:${toolMode}`
      : null;
  const autoApply = Boolean(
    autoApplyKey && activeView?.autoApply && effectAutoApply[autoApplyKey],
  );
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
  function getPreviewSignature(
    settings: ErasedSettings | undefined,
    mask = activeMask,
  ) {
    return JSON.stringify({
      documentSession,
      revision: historyDocument?.revision ?? 0,
      effectId: activeView?.id ?? null,
      componentIndex,
      settings,
      maskId: isMaskEffect ? (mask?.id ?? null) : null,
    });
  }
  const effectPreviewSignature = getPreviewSignature(activeSettings);
  const currentPreview =
    draftPreview?.signature === effectPreviewSignature ? draftPreview : null;
  const draftPreviewUrl = currentPreview?.frame.url;
  const isBusy = isEncoding || applying !== null;
  const needsAutomaticPreview =
    draftRequest !== null &&
    Boolean(activeView?.autoPreview && isMaskEffect && activeMask) &&
    !isBusy &&
    scanCorruptionReports.length === 0;
  const awaitingPreview =
    isDraftPreviewing ||
    (needsAutomaticPreview && !currentPreview && !previewFailed);
  const currentOperation = (() => {
    if (
      !document ||
      !activeEffect ||
      !activeSettings ||
      !isJpegOperationController(activeEffect.controller) ||
      activeEffect.view.interaction === "panel" ||
      (isMaskEffect && !activeMask)
    )
      return null;
    return activeEffect.controller.buildOperation({
      settings: activeSettings,
      inspection: document.inspection,
      componentIndex,
      mask: activeMask,
    });
  })();
  const canApply =
    draftRequest !== null &&
    !isBusy &&
    !isLoading &&
    (activeView?.interaction === "panel" || (currentOperation?.ok ?? false));
  const contextualErrorMessage = [
    effectSettingsError
      ? `${effectSettingsError} Effect settings may not be retained.`
      : "",
    documentHash && componentIndex >= componentCount
      ? `This image has no component ${componentIndex}. Choose another brush or component.`
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
    if (!needsAutomaticPreview || currentPreview || previewFailed) return;
    const timeout = window.setTimeout(() => {
      const previewCurrentEffect = previewCurrentEffectRef.current;
      if (previewCurrentEffect) void previewCurrentEffect();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    currentPreview,
    draftRequest,
    effectPreviewSignature,
    needsAutomaticPreview,
    previewFailed,
  ]);

  useEffect(() => {
    const dialog = exportOptionsRef.current;
    if (!dialog) return;
    if (isExportOptionsOpen && !dialog.open) dialog.showModal();
    else if (!isExportOptionsOpen && dialog.open) dialog.close();
  }, [isExportOptionsOpen]);

  useEffect(() => {
    const dialog = replaceDialogRef.current;
    if (!dialog) return;
    if (requestedFile && !dialog.open) dialog.showModal();
    else if (!requestedFile && dialog.open) dialog.close();
  }, [requestedFile]);

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
      if (draftPreview?.frame.url) URL.revokeObjectURL(draftPreview.frame.url);
    },
    [draftPreview],
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

  const publishCoefficientFrame = useCallback((frame: EncodedJpegFrame) => {
    cleanEncodedBytes.current = frame.bytes;
    setEditedBytes(frame.bytes);
    setEditedPreviewUrl((previous) => frame.url ?? previous);
    setEditedPreviewError(frame.displayError);
    setCleanEncodedPreviewUrl(
      frame.url ? createJpegPreviewUrl(frame.bytes) : null,
    );
    setCleanEncodedPreviewError(frame.displayError);
    setIsEncoding(false);
  }, []);

  useEffect(() => {
    if (!document || jpegOperations.length === 0) return;
    if (renderedOperations.current === jpegOperations) return;

    const controller = new AbortController();
    const history = operationHistory.current;
    void (async () => {
      const encoded = await encodeJpegFrame(
        document,
        orientation,
        jpegOperations,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        history !== operationHistory.current ||
        jpegOperations !== history?.snapshot.currentState.jpegOperations
      ) {
        if (encoded.ok && encoded.value.url) {
          URL.revokeObjectURL(encoded.value.url);
        }
        return;
      }
      if (!encoded.ok) {
        setErrorMessage(encoded.error.message);
        setEditedPreviewError(
          "The result could not be encoded. Showing the last available image.",
        );
        setIsEncoding(false);
        return;
      }
      renderedOperations.current = jpegOperations;
      publishCoefficientFrame(encoded.value);
    })();

    return () => controller.abort();
  }, [document, jpegOperations, orientation, publishCoefficientFrame]);

  useEffect(
    () => () => {
      importController.current?.abort();
      scanCorruptionController.current?.abort();
      previewAbortController.current?.abort();
      applyController.current?.abort();
    },
    [],
  );

  async function loadFile({ file, example = false }: RequestedFile) {
    const currentRequest = ++requestId.current;
    importController.current?.abort();
    const controller = new AbortController();
    importController.current = controller;
    setOpenError(null);
    setIsLoading(true);
    const isProjectFile = /\.jpglitch$/i.test(file.name);
    setLoadingMessage(isProjectFile ? "Opening project…" : "Opening photo…");

    let source: ImportedJpeg | null = null;
    let cleanFrame: EncodedJpegFrame | null = null;
    let damagedFrame: EncodedJpegFrame | null = null;
    let accepted = false;
    try {
      let projectData: JgeProjectData | null = null;
      let jpegFile = file;
      if (isProjectFile) {
        const savedProject = await readJgeProjectFile(
          file,
          (message) => {
            if (!controller.signal.aborted) setLoadingMessage(message);
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!savedProject.ok) throw new Error(savedProject.error.message);
        projectData = savedProject.value;
        const buffer = new ArrayBuffer(projectData.source.bytes.byteLength);
        new Uint8Array(buffer).set(projectData.source.bytes);
        jpegFile = new File([buffer], projectData.source.fileName, {
          type: "image/jpeg",
        });
        setLoadingMessage("Opening embedded photo…");
      }

      const imported = await importJpeg(jpegFile, controller.signal);
      if (imported.ok) source = imported.value;
      if (controller.signal.aborted) return;
      if (!imported.ok) throw new Error(imported.error.message);

      const history = createJpegDocumentSession(imported.value);
      if (!history.ok) throw new Error(history.error.message);
      const sourceOrientation = readJpegOrientation(
        imported.value.originalAsset.readBytes(),
        imported.value.inspection,
      );
      if (!sourceOrientation.ok)
        throw new Error(sourceOrientation.error.message);
      const wholeMask = createWholeImageMask(imported.value.inspection);
      if (!wholeMask.ok) throw new Error(wholeMask.error.message);
      const initialSelectionMask = projectData?.draftMask ?? wholeMask.value;
      const savedStages = projectData?.scanCorruptionStages ?? [];
      let damaged: CorruptedEncodedJpeg | null = null;
      if (projectData) {
        const restored = history.value.restoreOperations(
          projectData.operations,
        );
        if (!restored.ok) throw new Error(restored.error.message);
        if (
          initialSelectionMask.width !== imported.value.inspection.width ||
          initialSelectionMask.height !== imported.value.inspection.height
        )
          throw new Error(
            "The saved area dimensions do not match the embedded JPG.",
          );

        const operations = history.value.snapshot.currentState.jpegOperations;
        if (operations.length > 0 || savedStages.length > 0) {
          setLoadingMessage("Replaying project…");
          const encoded = await encodeJpegFrame(
            imported.value,
            sourceOrientation.value,
            operations,
            controller.signal,
          );
          if (encoded.ok) cleanFrame = encoded.value;
          if (controller.signal.aborted) return;
          if (!encoded.ok) throw new Error(encoded.error.message);
          if (savedStages.length > 0) {
            const scan = getScanCorruptionEffect();
            if (!scan)
              throw new Error("The JPEG Damage effect is unavailable.");
            const replayed = await scan.controller.execute_corrupt(
              encoded.value.bytes,
              savedStages,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (!replayed.ok) throw new Error(replayed.error.message);
            damaged = replayed.value;
            damagedFrame = await decodeJpegFrame(
              imported.value,
              sourceOrientation.value,
              damaged.bytes,
              controller.signal,
            );
            if (!damagedFrame) return;
          }
        }
      }
      scanCorruptionController.current?.abort();
      scanCorruptionController.current = null;
      scanCorruptionHistory.current.clear();
      cleanEncodedBytes.current = null;
      operationHistory.current = history.value;
      setHistoryDocument(history.value.snapshot);
      applyController.current?.abort();
      applyController.current = null;
      setApplying(null);
      discardDraftPreview();
      setDraftRequest(projectData ? null : 1);
      setEffectApplied(false);
      setDocumentSession((current) => current + 1);
      renderedOperations.current = cleanFrame
        ? history.value.snapshot.currentState.jpegOperations
        : null;
      setEditedPreviewUrl(null);
      setEditedBytes(null);
      setEditedPreviewError("");
      setCleanEncodedPreviewUrl(null);
      setCleanEncodedPreviewError("");
      setScanCorruptionReports([]);
      setScanDecodeDiagnostic(null);
      setIsScanCorrupting(false);
      setShowCleanEncoded(false);
      setIsEncoding(false);
      setHistoryAvailability({
        canUndo: history.value.canUndo,
        canRedo: history.value.canRedo,
      });
      resetCanvasInteraction();
      dispatchWorkspace({ type: "reset-document" });
      dispatchWorkspace({
        type: "activate-effect",
        effectId: DEFAULT_EFFECT_ID,
        usesMaskTools:
          getEffect(DEFAULT_EFFECT_ID)?.view.interaction === "mask",
      });
      setWholeImageMask(wholeMask.value);
      dispatchWorkspace({
        type: "activate-tool",
        tool: areaToolForMask(initialSelectionMask),
      });
      dispatchWorkspace({
        type: "set-selection",
        selection: initialSelectionMask,
      });
      setComponentIndex(0);
      setEffectSettings(createEffectSettings(persistedSettings.current));
      setBrushSize(32);
      setEffectAutoApply({});
      setMaskGrid("dct");
      dispatchWorkspace({ type: "select-mask", maskId: null });
      setShowBlocks(false);
      setShowMcus(false);
      setShowOriginal(false);
      setZoom(1);
      setDocument(imported.value);
      setExamplePhoto(example);
      setOperationEffectIds({});
      setShowHistory(false);
      setProjectNotice("");
      lastSavedProject.current = projectEditsKey({
        operations: history.value.snapshot.operations,
        draftMask: initialSelectionMask,
        scanCorruptionStages: savedStages,
      });
      if (
        cleanFrame &&
        (history.value.snapshot.currentState.jpegOperations.length > 0 ||
          damaged)
      ) {
        publishCoefficientFrame(cleanFrame);
      }
      if (damaged && damagedFrame) {
        for (const stage of savedStages)
          scanCorruptionHistory.current.record(stage);
        publishDamageFrame(damagedFrame, damaged.reports, damaged.diagnostic);
      }
      accepted = true;
      if (
        projectData &&
        (projectData.applicationVersion !== APPLICATION_VERSION ||
          projectData.codecVersion !== JPEG_CODEC_VERSION)
      ) {
        setProjectNotice(
          `Created with app ${projectData.applicationVersion} and ${projectData.codecVersion}; replayed JPEG output may differ from its previous export.`,
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : undefined;
        const message = detail?.includes("MiB")
          ? detail
          : isProjectFile
            ? "This project could not be opened."
            : "This JPG could not be opened. Try a different JPG.";
        setOpenError({
          message,
          detail: detail !== message ? detail : undefined,
        });
      }
    } finally {
      if (!accepted) {
        if (source) URL.revokeObjectURL(source.previewUrl);
        if (cleanFrame?.url) URL.revokeObjectURL(cleanFrame.url);
        if (damagedFrame?.url) URL.revokeObjectURL(damagedFrame.url);
      }
      if (currentRequest === requestId.current) {
        importController.current = null;
        setIsLoading(false);
      }
    }
  }

  function updateHistory(
    result: ReturnType<OperationHistory<JpegEditableState>["add"]>,
    appliedFrame?: EncodedJpegFrame,
  ) {
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }
    discardDraftPreview();
    setDraftRequest(null);
    setEffectApplied(Boolean(appliedFrame));
    const previousJpegOperations = historyDocument?.currentState.jpegOperations;
    const nextOperations = result.value.currentState.jpegOperations;
    if (nextOperations !== previousJpegOperations) {
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
        setErrorMessage("Undo the damage stages to edit earlier effects.");
        return;
      }
      scanCorruptionController.current?.abort();
      scanCorruptionController.current = null;
      scanCorruptionHistory.current.clear();
      cleanEncodedBytes.current = null;
      renderedOperations.current = null;
      setScanCorruptionReports([]);
      setScanDecodeDiagnostic(null);
      setEditedBytes(null);
      setEditedPreviewError("");
      setCleanEncodedPreviewUrl(null);
      setCleanEncodedPreviewError("");
      if (appliedFrame) {
        renderedOperations.current = nextOperations;
        publishCoefficientFrame(appliedFrame);
      } else {
        if (nextOperations.length === 0) setEditedPreviewUrl(null);
        setIsEncoding(nextOperations.length > 0);
      }
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
    if (isBusy || isLoading || applyController.current) return;
    if (!ensureCoefficientPhase()) return;
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
    if (feedback.error !== undefined) setCanvasError(feedback.error);
    if (feedback.selection) {
      setCanvasError("");
      const { mask, autoApply } = feedback.selection;
      dispatchWorkspace({ type: "set-selection", selection: mask });
      requestEffectDraft();
      if (mask && autoApply) void autoApplySelectionEffect(mask);
    }
    if (feedback.effect) {
      const { ownerId, patch, apply } = feedback.effect;
      if (patch) {
        requestEffectDraft();
        setEffectSettings((current) => ({
          ...current,
          [ownerId]: mergeSettings(current[ownerId] ?? {}, patch),
        }));
      }
      if (apply) void applyEffect(patch, activeMask, { gesture: true });
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
    if (!canvasContext || applyController.current || isLoading) return;
    const shouldFocusCanvas = canvasPointer.begin(
      event,
      pointerInput(event),
      canvasContext,
      canvasInteraction,
      spacePanActive.current,
      setIsPanning,
    );
    if (shouldFocusCanvas)
      previewImageWrap.current?.focus({ preventScroll: true });
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
    setCanvasError("");
  }

  function activateTool(tool: MaskTool) {
    if (applyController.current || !enabledCanvasTools.has(tool)) return;
    resetCanvasInteraction();
    dispatchWorkspace({ type: "activate-tool", tool });
    if (tool !== toolMode && tool !== "all") requestEffectDraft();
    setCanvasKeyboardAnnouncement(
      `${getMaskToolView(tool).label} tool selected.`,
    );
    if (canvasContext) canvasTools.get(tool)?.activate?.(canvasContext);
    setShowHistory(false);
  }

  function activateEffect(effectId: string) {
    const effect = getEffect(effectId);
    if (!effect) return;
    if (applyController.current) return;
    resetCanvasInteraction();
    requestEffectDraft();
    setErrorMessage("");
    dispatchWorkspace({
      type: "activate-effect",
      effectId,
      usesMaskTools: effect.view.interaction === "mask",
    });
    setShowHistory(false);
  }

  function changeEffectSettings(
    patch: Partial<ErasedSettings> | undefined,
    persist = true,
  ) {
    const view = activeView;
    if (!view || !patch || applyController.current) return;
    requestEffectDraft();
    if (persist) {
      canvasPointer.cancel();
      setCanvasError("");
    }
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
    if (applyController.current) return;
    resetCanvasInteraction();
    requestEffectDraft();
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
    const built =
      !patch && mask === activeMask && currentOperation
        ? currentOperation
        : controller.buildOperation({
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
    setErrorMessage("Undo the damage stages to edit earlier effects.");
    return false;
  }

  async function applyEffect(
    patch?: Partial<ErasedSettings>,
    mask: SpatialMask | null = activeMask,
    options?: {
      readonly gesture?: boolean;
      readonly autoApply?: "stroke" | "selection";
      readonly download?: boolean;
    },
  ) {
    if (
      applyController.current ||
      isBusy ||
      isLoading ||
      (!options?.gesture && !canApply) ||
      !ensureCoefficientPhase()
    )
      return;
    const source = document;
    const history = operationHistory.current;
    if (
      !source ||
      !history ||
      !activeEffect ||
      history.snapshot !== historyDocument
    )
      return;
    const { controller } = activeEffect;
    if (!isJpegOperationController(controller)) return;
    const settings = mergeSettings(activeSettings ?? {}, patch);
    const cached =
      draftPreview?.signature === getPreviewSignature(settings, mask)
        ? draftPreview
        : null;
    const operation = cached?.operation ?? buildActiveOperation(patch, mask);
    if (!operation) return;
    const base = history.snapshot;
    const operations = [...base.currentState.jpegOperations, operation];
    const job = new AbortController();
    applyController.current = job;
    discardDraftPreview();
    setApplying(options?.autoApply ?? "effect");
    setErrorMessage("");

    try {
      const encoded = cached
        ? {
            ok: true as const,
            value: {
              ...cached.frame,
              url: cached.frame.url
                ? createJpegPreviewUrl(cached.frame.bytes)
                : null,
            },
          }
        : await encodeJpegFrame(source, orientation, operations, job.signal);
      if (
        job.signal.aborted ||
        history !== operationHistory.current ||
        base !== history.snapshot
      ) {
        if (encoded.ok && encoded.value.url)
          URL.revokeObjectURL(encoded.value.url);
        return;
      }
      if (!encoded.ok) {
        setPreviewFailed(true);
        setErrorMessage(encoded.error.message);
        return;
      }

      const result = controller.apply(history, operation, base.inspection);
      if (!result.ok) {
        if (encoded.value.url) URL.revokeObjectURL(encoded.value.url);
        setErrorMessage(result.error.message);
        return;
      }
      const added = result.value.operations.at(-1);
      if (added)
        setOperationEffectIds((effects) => ({
          ...effects,
          [added.id]: activeEffect.view.id,
        }));
      updateHistory(result, encoded.value);
      if (options?.autoApply) {
        dispatchWorkspace({ type: "set-selection", selection: null });
      }
      if (options?.download) {
        await downloadJpeg(
          source,
          result.value.currentState.jpegOperations,
          encoded.value.bytes,
          exportMode,
        );
      }
    } catch (error) {
      if (!job.signal.aborted) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "The effect could not be applied.",
        );
      }
    } finally {
      if (applyController.current === job) {
        applyController.current = null;
        setApplying(null);
      }
    }
  }

  function changeEffectAutoApply(checked: boolean) {
    if (!autoApplyKey || !activeView?.autoApply || applyController.current)
      return;
    resetCanvasInteraction();
    setEffectAutoApply((current) => ({ ...current, [autoApplyKey]: checked }));
  }

  async function autoApplySelectionEffect(mask: SpatialMask) {
    if (!autoApply) return;
    await applyEffect(undefined, mask, {
      gesture: true,
      autoApply: toolMode === "brush" ? "stroke" : "selection",
    });
  }

  function discardDraftPreview() {
    previewAbortController.current?.abort();
    previewAbortController.current = null;
    previewCoordinator.current.cancel();
    setDraftPreview(null);
    setIsDraftPreviewing(false);
    setPreviewFailed(false);
  }

  function requestEffectDraft() {
    discardDraftPreview();
    if (scanCorruptionReports.length === 0) setShowCleanEncoded(false);
    setDraftRequest((current) => (current ?? 0) + 1);
    setEffectApplied(false);
  }

  async function previewCurrentEffect(patch?: Partial<ErasedSettings>) {
    if (
      !document ||
      !historyDocument ||
      !activeView ||
      isBusy ||
      applyController.current
    )
      return;
    if (!ensureCoefficientPhase()) return;

    discardDraftPreview();
    if (patch) {
      setEffectSettings((current) => ({
        ...current,
        [activeView.id]: mergeSettings(current[activeView.id] ?? {}, patch),
      }));
      setDraftRequest((current) => (current ?? 0) + 1);
      setEffectApplied(false);
    }
    const operation = buildActiveOperation(patch, activeMask);
    if (!operation) {
      setPreviewFailed(true);
      return;
    }
    const signature = getPreviewSignature(
      mergeSettings(activeSettings ?? {}, patch),
    );
    const controller = new AbortController();
    previewAbortController.current = controller;
    const coordinator = previewCoordinator.current;
    const history = operationHistory.current;
    const token = coordinator.begin(historyDocument.revision);
    setIsDraftPreviewing(true);
    setErrorMessage("");

    try {
      const encoded = await encodeJpegFrame(
        document,
        orientation,
        [...jpegOperations, operation],
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        history !== operationHistory.current ||
        !coordinator.isCurrent(token, history?.snapshot.revision ?? -1)
      ) {
        if (encoded.ok && encoded.value.url)
          URL.revokeObjectURL(encoded.value.url);
        return;
      }
      if (!encoded.ok) {
        setPreviewFailed(true);
        setErrorMessage(encoded.error.message);
        return;
      }
      setDraftPreview({ signature, operation, frame: encoded.value });
    } catch (error) {
      if (!controller.signal.aborted) {
        setPreviewFailed(true);
        setErrorMessage(
          error instanceof Error ? error.message : "The effect preview failed.",
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

  function resetHistory() {
    if (isBusy || isLoading || applyController.current) return;
    if (
      !window.confirm(
        scanCorruptionReports.length > 0
          ? "Remove all effects? This clears the current area and all damage stages. Undo can restore ordinary effects."
          : "Remove all effects? This clears the current area. Undo can restore effects.",
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
    resetCanvasInteraction();
    if (!isMaskEffect) {
      dispatchWorkspace({
        type: "activate-effect",
        effectId: DEFAULT_EFFECT_ID,
        usesMaskTools: true,
      });
    }
    dispatchWorkspace({ type: "activate-tool", tool: "all" });
    dispatchWorkspace({ type: "set-selection", selection: wholeImageMask });
  }

  function restoreHistoryMask(mask: SpatialMask) {
    if (isBusy || isLoading || applyController.current) return;
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
    if (!isMaskEffect) activateEffect(DEFAULT_EFFECT_ID);
    const areaTool = areaToolForMask(restored.value);
    dispatchWorkspace({ type: "activate-tool", tool: areaTool });
    resetCanvasInteraction();
    requestEffectDraft();
    dispatchWorkspace({
      type: "set-selection",
      selection: areaTool === "all" ? wholeImageMask : restored.value,
    });
    setErrorMessage("");
  }

  const publishDamageFrame = useCallback(
    (
      frame: EncodedJpegFrame,
      reports: readonly ScanCorruptionReport[],
      diagnostic: ScanDecodeDiagnostic,
    ) => {
      setEditedBytes(frame.bytes);
      setEditedPreviewUrl(frame.url);
      setEditedPreviewError(frame.displayError);
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
    [],
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
      setShowOriginal(false);
      setShowCleanEncoded(false);
      if (!cleanBytes) {
        const encoded = await encodeJpegFrame(
          document,
          orientation,
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
        cleanBytes = encoded.value.bytes;
        cleanEncodedBytes.current = cleanBytes;
        cleanEncodedPreviewErrorRef.current = encoded.value.displayError;
        setCleanEncodedPreviewUrl(encoded.value.url);
        setCleanEncodedPreviewError(encoded.value.displayError);
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
      const frame = await decodeJpegFrame(
        document,
        orientation,
        corrupted.value.bytes,
        controller.signal,
      );
      if (!frame) return;
      if (!commitHistory()) {
        if (frame.url) URL.revokeObjectURL(frame.url);
        setErrorMessage("The JPEG Damage history could not be updated.");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        return;
      }
      publishDamageFrame(
        frame,
        corrupted.value.reports,
        corrupted.value.diagnostic,
      );
    },
    [document, jpegOperations.length, orientation, publishDamageFrame],
  );

  function closeEffectDraft() {
    discardDraftPreview();
    setDraftRequest(null);
    setEffectApplied(false);
  }

  function applyScanCorruption(settings: object) {
    if (
      isBusy ||
      isLoading ||
      applyController.current ||
      scanCorruptionController.current
    )
      return;
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
    closeEffectDraft();
    void replayScanStages(stages, () => history.record(parameters).ok);
  }

  function updateLastScanCorruption(settings: object) {
    if (
      isBusy ||
      isLoading ||
      applyController.current ||
      scanCorruptionController.current
    )
      return;
    const scan = getScanCorruptionEffect();
    const history = scanCorruptionHistory.current;
    if (!scan || history.activeStages.length === 0) return;
    const parameters = scan.controller.toParameters(settings);
    const stages = [...history.activeStages.slice(0, -1), parameters];
    closeEffectDraft();
    void replayScanStages(stages, () => history.replaceLast(parameters).ok);
  }

  function undoScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (!history.canUndo) return false;
    closeEffectDraft();
    void replayScanStages(history.undoTarget, () => history.commitUndo());
    return true;
  }

  function redoScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (!history.canRedo) return false;
    closeEffectDraft();
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
    setErrorMessage("Damage cancelled. Showing the previous result.");
  }

  function handleUndo() {
    if (isBusy || isLoading || applyController.current) return;
    if (undoScanCorruption()) return;
    const history = operationHistory.current;
    if (history) updateHistory(history.undo());
  }

  function handleRedo() {
    if (isBusy || isLoading || applyController.current) return;
    if (redoScanCorruption()) return;
    if (scanCorruptionHistory.current.activeStages.length > 0) return;
    const history = operationHistory.current;
    if (history) updateHistory(history.redo());
  }

  async function downloadJpeg(
    source: ImportedJpeg,
    operations: readonly JpegGlitchOperation[],
    bytes: Uint8Array,
    mode: JpegOutputMode,
  ) {
    setIsExporting(true);
    setErrorMessage("");
    try {
      let output = bytes;
      if (mode === "progressive") {
        const encoded = await encodeJpegCoefficients(
          source.originalAsset.readBytes(),
          jpegGeometry(source),
          operations,
          undefined,
          { mode },
        );
        if (!encoded.ok) {
          setErrorMessage(encoded.error.message);
          return;
        }
        output = encoded.value;
      }
      const name = source.originalAsset.fileName.replace(/\.[^.]+$/, "");
      downloadFileUrl(
        createJpegPreviewUrl(output),
        `${name}.edited${mode === "progressive" ? ".progressive" : ""}.jpg`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The JPG could not be downloaded.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  function downloadEditedJpeg() {
    if (!document || !editedBytes || isBusy || isExporting) return;
    void downloadJpeg(
      document,
      jpegOperations,
      editedBytes,
      scanCorruptionReports.length > 0 ? "baseline" : exportMode,
    );
  }

  function downloadCurrentJpeg() {
    if (currentPreview && !hasScanCorruption) {
      void applyEffect(undefined, activeMask, { download: true });
    } else {
      downloadEditedJpeg();
    }
  }

  function projectEdits() {
    return {
      operations: operationHistory.current?.snapshot.operations ?? [],
      draftMask: globalSelectionMask,
      scanCorruptionStages: scanCorruptionHistory.current.activeStages,
    };
  }

  async function downloadProjectFile(): Promise<boolean> {
    if (!document || !historyDocument || savingProject.current) return false;
    const history = operationHistory.current;
    const edits = projectEdits();
    const snapshot: JgeProjectSaveData = {
      source: {
        fileName: document.originalAsset.fileName,
        sha256: document.originalAsset.sha256,
        bytes: document.originalAsset.readBytes(),
      },
      ...edits,
    };
    const key = projectEditsKey(edits);
    savingProject.current = true;
    setIsSavingProject(true);
    setErrorMessage("");
    try {
      const result = await createJgeProjectFile(snapshot, {
        application: APPLICATION_VERSION,
        codec: JPEG_CODEC_VERSION,
      });
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return false;
      }
      const baseName =
        document.originalAsset.fileName
          .replace(/\.[^.]+$/, "")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 100) || "project";
      downloadFileUrl(
        URL.createObjectURL(result.value),
        `${baseName}.jpglitch`,
      );
      if (history === operationHistory.current) lastSavedProject.current = key;
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The project could not be saved.",
      );
      return false;
    } finally {
      savingProject.current = false;
      setIsSavingProject(false);
    }
  }

  function openFilePicker(kind: "photo" | "project" | "any") {
    if (isBusy || isLoading || savingProject.current || !fileInput.current)
      return;
    if (fileMenu.current) fileMenu.current.open = false;
    fileInput.current.accept =
      kind === "photo"
        ? PHOTO_TYPES
        : kind === "project"
          ? PROJECT_TYPES
          : `${PHOTO_TYPES},${PROJECT_TYPES}`;
    fileInput.current.click();
  }

  function requestOpen(next: RequestedFile) {
    if (isBusy || applyController.current || savingProject.current) return;
    setOpenError(null);
    if (
      !/\.(jpe?g|jpglitch)$/i.test(next.file.name) &&
      next.file.type !== "image/jpeg"
    ) {
      setOpenError({ message: "Choose a JPG, JPEG or .jpglitch file." });
      return;
    }
    if (
      document &&
      projectEditsKey(projectEdits()) !== lastSavedProject.current
    ) {
      setRequestedFile(next);
    } else {
      void loadFile(next);
    }
  }

  async function openExample() {
    if (isLoading || isFetchingExample) return;
    setIsFetchingExample(true);
    setOpenError(null);
    try {
      const response = await fetch(examplePhotoUrl("original"));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const photo = new File([await response.blob()], "example.jpg", {
        type: "image/jpeg",
      });
      requestOpen({ file: photo, example: true });
    } catch (error) {
      setOpenError({
        message: "The example could not be opened. Try opening your own JPG.",
        detail: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsFetchingExample(false);
    }
  }

  async function confirmOpen(save: boolean) {
    if (!requestedFile || savingProject.current) return;
    if (save && !(await downloadProjectFile())) return;
    const next = requestedFile;
    setRequestedFile(null);
    await loadFile(next);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) requestOpen({ file });
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
      setOpenError({ message: "Open one photo or project at a time." });
      return;
    }
    if (files[0]) requestOpen({ file: files[0] });
  }

  const overlayVisibility = getWorkspaceOverlayVisibility(toolMode);
  const showAreaOutline = overlayVisibility.mask && toolMode !== "all";
  const activeMaskForOverlay = showAreaOutline ? activeMask : null;
  const visibleSelection = showAreaOutline
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
        wholeImageMask: wholeImageMask ?? undefined,
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
  const visibleKeyboardCursor =
    canvasHasKeyboardFocus && canvasImageContext
      ? (keyboardCursor ??
        canvasInteraction?.getInitialCursor?.(canvasImageContext) ??
        null)
      : null;
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
    document !== null &&
    !isBusy &&
    !isLoading &&
    (jpegOperations.length === 0 || editedBytes !== null);
  const compareBeforeCurrent = Boolean(
    currentPreview && editedPreviewUrl && !hasScanCorruption,
  );
  const beforeVisible =
    !showOriginal &&
    (hasScanCorruption
      ? Boolean(
          cleanEncodedPreviewUrl && (showCleanEncoded || !editedPreviewUrl),
        )
      : showCleanEncoded && compareBeforeCurrent);
  const afterDamageVisible =
    hasScanCorruption &&
    !showOriginal &&
    !showCleanEncoded &&
    Boolean(editedPreviewUrl);
  const previewUrlToDisplay = showOriginal
    ? document?.previewUrl
    : hasScanCorruption
      ? ((afterDamageVisible ? editedPreviewUrl : cleanEncodedPreviewUrl) ??
        document?.previewUrl)
      : ((beforeVisible
          ? editedPreviewUrl
          : (draftPreviewUrl ?? editedPreviewUrl)) ?? document?.previewUrl);
  const showsOriginalFrame = previewUrlToDisplay === document?.previewUrl;

  function getPreviewStatus(): string {
    if (applying === "stroke") return "Applying stroke…";
    if (applying === "selection") return "Applying selection…";
    if (applying) return "Applying effect…";
    if (isEncoding)
      return isScanCorrupting ? "Applying damage…" : "Updating result…";
    if (hasScanCorruption) {
      if (showOriginal) return "Original photo";
      if (!showCleanEncoded && !afterDamageVisible) {
        return `Cannot show the damaged JPG. Showing ${beforeVisible ? "the image before damage" : "the original photo"}.`;
      }
      if (beforeVisible) return "Before damage";
      if (
        afterDamageVisible &&
        scanDecodeDiagnostic &&
        scanDecodeDiagnostic.status !== "complete" &&
        scanDecodeDiagnostic.status !== "unavailable"
      ) {
        return "JPEG opened with warnings. Other apps may display it differently.";
      }
      return afterDamageVisible ? "After damage" : "Original photo";
    }
    if (showOriginal) return "Original photo";
    if (beforeVisible) return "Applied result before current effect";
    if (awaitingPreview) return "Updating preview…";
    const displayFailure =
      currentPreview?.frame.displayError || editedPreviewError;
    if (displayFailure)
      return `${displayFailure} Showing ${showsOriginalFrame ? "the original" : "the last available image"}.`;
    if (currentPreview) return "Preview";
    if (effectApplied) return "Effect applied";
    if (
      draftRequest !== null &&
      isMaskEffect &&
      activeMask &&
      !activeView?.autoPreview
    )
      return "Preview available";
    return "";
  }

  useEffect(() => {
    function onWorkspaceKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        exportOptionsRef.current?.open ||
        replaceDialogRef.current?.open
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"))
      ) {
        return;
      }
      if (event.code === "Space" && document) {
        if (
          target instanceof HTMLElement &&
          target.closest("button, a[href], summary, [role='button']")
        )
          return;
        event.preventDefault();
        spacePanActive.current = true;
        return;
      }

      const shortcut = getWorkspaceShortcut(event);
      if (shortcut === "select-all") {
        if (
          isMaskEffect &&
          target === previewImageWrap.current &&
          !applyController.current
        ) {
          event.preventDefault();
          if (!event.repeat) activateTool("all");
        }
        return;
      }
      if (
        canvasContext &&
        !applyController.current &&
        canvasInteraction?.handleKey?.(
          {
            key: event.key,
            repeat: event.repeat,
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
      if (!event.ctrlKey && !event.metaKey && !event.altKey && document) {
        const key = event.key.toUpperCase();
        const action = topBarActions.find(
          ({ shortcut: actionShortcut, disabled }) =>
            actionShortcut === key && !disabled,
        );
        if (action) {
          event.preventDefault();
          if (!event.repeat) runTopBarAction(action);
          return;
        }
        const tool = toolbarTools.find(
          (id) =>
            enabledCanvasTools.has(id) && getMaskToolView(id).shortcut === key,
        );
        if (!tool) return;
        event.preventDefault();
        if (!event.repeat) activateTool(tool);
        return;
      }
      if (!shortcut) return;
      event.preventDefault();
      if (event.repeat) return;
      if (shortcut === "open-file") openFilePicker("any");
      if (shortcut === "save" && !isLoading && !isBusy)
        void downloadProjectFile();
      if (shortcut === "undo") handleUndo();
      if (shortcut === "redo") handleRedo();
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
      setError: (message) => {
        setErrorMessage(message);
      },
      apply: (patch) => {
        void applyEffect(patch);
      },
      preview: (patch) => {
        void previewCurrentEffect(patch);
      },
      discardPreview: requestEffectDraft,
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
        operationError:
          currentOperation && !currentOperation.ok
            ? currentOperation.error.message
            : "",
        componentIndex,
        hasMask: activeMask !== null,
        isEncoding: isBusy,
        isPreviewing: isDraftPreviewing,
        canApply,
        hasScanCorruption,
        autoApplyPrompt: autoApply
          ? toolMode === "brush"
            ? "Paint a stroke to apply the effect."
            : "Draw a rectangle to apply the effect."
          : "",
        scanCorruption: {
          canApply: canApplyScanCorruption,
          isCorrupting: isScanCorrupting,
          hasScanCorruption,
          hasJpegOperations: jpegOperations.length > 0,
          reports: scanCorruptionReports,
          diagnostic: scanDecodeDiagnostic,
          apply: editorBridge.applyScan,
          updateLastStage: editorBridge.updateLastScan,
          cancel: editorBridge.cancelScan,
        },
        onChangeComponent: editorBridge.changeComponent,
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
              className={`active-file ${examplePhoto ? "is-example" : ""}`}
              title={document.originalAsset.fileName}
            >
              {examplePhoto ? "Example photo" : document.originalAsset.fileName}
            </span>
          )}
          {document && (
            <div className="history-toolbar" aria-label="Operation history">
              <button
                className="history-toolbar-button"
                type="button"
                onClick={handleUndo}
                disabled={!historyAvailability.canUndo || isBusy}
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
                disabled={!historyAvailability.canRedo || isBusy}
                aria-label="Redo"
                aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
                title="Redo"
              >
                ↷
              </button>
            </div>
          )}
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept={`${PHOTO_TYPES},${PROJECT_TYPES}`}
            aria-label="Choose a JPEG or editor project file"
            tabIndex={-1}
            onChange={onFileChange}
          />
          <details className="file-menu canvas-menu" ref={fileMenu}>
            <summary className="tool-toggle">File</summary>
            <div className="canvas-popover file-menu-items">
              <button
                type="button"
                onClick={() => openFilePicker("photo")}
                disabled={isBusy || isLoading}
              >
                Open photo…
              </button>
              <button
                type="button"
                onClick={() => openFilePicker("project")}
                disabled={isBusy || isLoading}
              >
                Open project…
              </button>
              <button
                type="button"
                disabled={isBusy || isLoading || isFetchingExample}
                onClick={() => {
                  if (fileMenu.current) fileMenu.current.open = false;
                  void openExample();
                }}
              >
                Try an example
              </button>
              <button
                type="button"
                aria-keyshortcuts="Control+S Meta+S"
                disabled={!document || isBusy || isLoading || isSavingProject}
                onClick={() => {
                  if (fileMenu.current) fileMenu.current.open = false;
                  void downloadProjectFile();
                }}
              >
                Save project…
              </button>
              <button
                type="button"
                disabled={!document || isLoading}
                onClick={() => {
                  if (fileMenu.current) fileMenu.current.open = false;
                  setIsExportOptionsOpen(true);
                }}
              >
                JPEG export options…
              </button>
            </div>
          </details>
          {document && (
            <button
              className="export-button"
              type="button"
              onClick={downloadCurrentJpeg}
              disabled={
                isBusy ||
                isLoading ||
                isExporting ||
                awaitingPreview ||
                (!currentPreview && !editedBytes)
              }
            >
              {isExporting
                ? "Preparing download…"
                : hasScanCorruption
                  ? "Download damaged JPG"
                  : currentPreview
                    ? "Apply and download JPG"
                    : editedBytes
                      ? draftRequest !== null
                        ? "Download applied JPG"
                        : "Download result JPG"
                      : "Apply an effect first"}
            </button>
          )}
        </div>
      </header>

      {document && (
        <dialog
          ref={exportOptionsRef}
          className="save-dialog"
          aria-labelledby="export-options-title"
          onCancel={() => setIsExportOptionsOpen(false)}
          onClose={() => setIsExportOptionsOpen(false)}
        >
          <h2 id="export-options-title">JPEG export options</h2>
          <label className="save-dialog-mode">
            JPEG output mode
            <select
              value={hasScanCorruption ? "baseline" : exportMode}
              disabled={hasScanCorruption}
              onChange={(event) =>
                setExportMode(
                  event.target.value === "progressive"
                    ? "progressive"
                    : "baseline",
                )
              }
            >
              <option value="baseline">Standard</option>
              <option value="progressive">Progressive</option>
            </select>
          </label>
          <p className="save-dialog-note">
            {hasScanCorruption
              ? "JPEG Damage exports the bytes of the current damage stage in Standard mode."
              : "JPG downloads use the applied edits. Progressive mode re-encodes the JPEG with multiple scans."}
          </p>
          <details className="advanced-controls">
            <summary>Encoding details</summary>
            <p>
              Progressive and Standard use the same quantized coefficients. EXIF
              and ICC metadata preservation depends on the encoder.
            </p>
          </details>
          <button
            className="operation-button"
            type="button"
            onClick={() => setIsExportOptionsOpen(false)}
          >
            Done
          </button>
        </dialog>
      )}
      {requestedFile && (
        <dialog
          ref={replaceDialogRef}
          className="save-dialog"
          aria-labelledby="replace-file-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!isSavingProject) setRequestedFile(null);
          }}
        >
          <h2 id="replace-file-title">Open another file?</h2>
          <p>
            Save the current applied edits and area to continue editing later.
          </p>
          {errorMessage && (
            <p className="open-error" role="alert">
              {errorMessage}
            </p>
          )}
          <div className="save-dialog-actions">
            <button
              className="operation-button"
              type="button"
              disabled={isSavingProject}
              onClick={() => void confirmOpen(true)}
            >
              Save project
            </button>
            <button
              className="operation-button secondary"
              type="button"
              disabled={isSavingProject}
              onClick={() => void confirmOpen(false)}
            >
              Open another file
            </button>
            <button
              className="tool-toggle"
              type="button"
              autoFocus
              disabled={isSavingProject}
              onClick={() => setRequestedFile(null)}
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
        <div className="canvas-column">
          <div className="workspace-feedback">
            {(openError || isLoading) && (
              <section className="file-status" aria-label="Opening a file">
                {isLoading && <p role="status">{loadingMessage}</p>}
                {openError && (
                  <div className="open-error">
                    <p role="alert">{openError.message}</p>
                    {openError.detail && (
                      <details>
                        <summary>Details</summary>
                        <p>{openError.detail}</p>
                      </details>
                    )}
                  </div>
                )}
              </section>
            )}
            {visibleErrorMessage && !requestedFile && (
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
          </div>
          <div className="canvas">
            {!document ? (
              <WelcomeScreen
                onOpenPhoto={() => openFilePicker("photo")}
                onTryExample={() => void openExample()}
                busy={isLoading || isFetchingExample}
              />
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
                    autoApply={autoApply}
                    onAutoApplyChange={
                      activeView?.autoApply && !isBusy
                        ? changeEffectAutoApply
                        : undefined
                    }
                    hasArea={activeMask !== null}
                  />
                  <div className="preview-view-row">
                    <div
                      className="preview-compare"
                      role="group"
                      aria-label="Compare images"
                    >
                      <button
                        className="tool-toggle"
                        type="button"
                        aria-pressed={
                          hasScanCorruption ? showsOriginalFrame : showOriginal
                        }
                        onClick={() => {
                          setShowOriginal(true);
                          setShowCleanEncoded(false);
                        }}
                      >
                        Original
                      </button>
                      {hasScanCorruption ? (
                        <>
                          <button
                            className="tool-toggle"
                            type="button"
                            aria-pressed={beforeVisible}
                            disabled={!cleanEncodedPreviewUrl}
                            onClick={() => {
                              setShowOriginal(false);
                              setShowCleanEncoded(true);
                            }}
                          >
                            Before damage
                          </button>
                          <button
                            className="tool-toggle"
                            type="button"
                            aria-pressed={afterDamageVisible}
                            disabled={!editedPreviewUrl}
                            onClick={() => {
                              setShowOriginal(false);
                              setShowCleanEncoded(false);
                            }}
                          >
                            After damage
                          </button>
                        </>
                      ) : (
                        <button
                          className="tool-toggle"
                          type="button"
                          aria-pressed={!showOriginal && !beforeVisible}
                          onClick={() => {
                            setShowOriginal(false);
                            setShowCleanEncoded(false);
                          }}
                        >
                          Result
                        </button>
                      )}
                      {compareBeforeCurrent && (
                        <button
                          className="tool-toggle"
                          type="button"
                          aria-pressed={beforeVisible}
                          onClick={() => {
                            setShowOriginal(false);
                            setShowCleanEncoded(true);
                          }}
                        >
                          Before current effect
                        </button>
                      )}
                    </div>
                    <span className="preview-state" role="status">
                      {getPreviewStatus()}
                    </span>
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
                      <details className="canvas-menu">
                        <summary className="tool-toggle">View</summary>
                        <fieldset className="overlay-checkboxes canvas-popover">
                          <legend>JPEG grids</legend>
                          <label>
                            <input
                              type="checkbox"
                              checked={showBlocks}
                              onChange={(event) =>
                                setShowBlocks(event.currentTarget.checked)
                              }
                            />
                            <span>DCT blocks</span>
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
                        </fieldset>
                      </details>
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
                    aria-keyshortcuts={
                      isMaskEffect ? "Control+A Meta+A" : undefined
                    }
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
                        alt={`${showsOriginalFrame ? "Original" : beforeVisible ? (hasScanCorruption ? "Before damage" : "Before the current effect") : previewUrlToDisplay === draftPreviewUrl ? "Effect preview" : hasScanCorruption && previewUrlToDisplay === editedPreviewUrl ? "Damaged" : "Applied"} JPEG of ${document.originalAsset.fileName}`}
                      />
                    ) : null}
                    <ImageOverlays
                      inspection={document.inspection}
                      orientation={orientation}
                      showBlocks={showBlocks}
                      showMcus={showMcus}
                      selection={visibleSelection}
                      mask={activeMaskForOverlay}
                      brushDraft={
                        maskDraft?.kind === "brush" ? maskDraft.strokes : []
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
                      keyboardCursor={visibleKeyboardCursor}
                      gestureSource={gestureOverlay?.source ?? null}
                      gestureSourceLabel={gestureOverlay?.sourceLabel}
                      gestureSourceInvalid={
                        gestureOverlay?.sourceInvalid ?? false
                      }
                      gestureDestinations={
                        gestureOverlay?.destinations ??
                        (gestureOverlay?.destination
                          ? [gestureOverlay.destination]
                          : [])
                      }
                      gestureDestinationInvalid={
                        gestureOverlay?.destinationInvalid ?? false
                      }
                    />
                  </div>
                </div>
                {(canvasError || canvasHint) && (
                  <p
                    id="canvas-tool-help"
                    className="canvas-keyboard-help"
                    role={canvasError ? "status" : undefined}
                  >
                    {canvasError || canvasHint?.text}
                    {canvasHint?.keyboard && (
                      <span className="visually-hidden">
                        {" "}
                        {canvasHint.keyboard}
                      </span>
                    )}
                  </p>
                )}
                {canvasHint?.keyboard && (
                  <details className="canvas-shortcuts">
                    <summary>Canvas shortcuts</summary>
                    {canvasHint.keyboard}
                  </details>
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
                <span>Drop a JPG or project</span>
              </div>
            )}
          </div>
        </div>

        {document && (
          <EffectCatalogPanel
            groups={EFFECT_MENU}
            registry={EFFECT_REGISTRY}
            selectedEffectId={activeView?.id ?? null}
            hasActiveMask={activeMask !== null}
            onSelectEffect={activateEffect}
          />
        )}
        {document && editor && (
          <aside className="side-panel">
            {document && editor && (
              <div className="side-panel-header">
                <h2>{showHistory ? "History" : activeToolLabel}</h2>
                <button
                  className="tool-toggle"
                  type="button"
                  aria-pressed={showHistory}
                  aria-controls="operation-history"
                  onClick={() => setShowHistory((visible) => !visible)}
                >
                  {showHistory
                    ? "Effect settings"
                    : `History · ${(historyDocument?.operations.length ?? 0) + scanCorruptionReports.length}`}
                </button>
              </div>
            )}
            <div className="side-panel-content">
              {projectNotice && (
                <p className="project-notice" role="status">
                  {projectNotice}
                </p>
              )}
              {document && editor ? (
                <>
                  <div className="active-tool-panel" hidden={showHistory}>
                    {activeView && activeSettings && (
                      <>
                        <p className="effect-summary">
                          {activeView.description}
                        </p>
                        <activeView.Panel
                          settings={activeSettings}
                          editor={editor}
                          onChangeSettings={changeEffectSettings}
                        />
                      </>
                    )}
                    {currentPreview && (
                      <p className="project-preview-note">
                        A project saves the original photo, applied edits and
                        working area.
                      </p>
                    )}
                  </div>
                  <div
                    id="operation-history"
                    className="history-panel"
                    hidden={!showHistory}
                  >
                    <OperationHistoryPanel
                      operations={historyDocument?.operations ?? []}
                      effectIds={operationEffectIds}
                      scanCorruptionReports={scanCorruptionReports}
                      hasScanCorruption={hasScanCorruption}
                      isBusy={isBusy || isLoading}
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
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}

export default App;
