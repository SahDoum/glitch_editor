import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
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
  readJpegOrientation,
} from "./application/preview-orientation";
import {
  createJgeProjectFile,
  readJgeProjectFile,
  type JgeProjectData,
} from "./project/project-file";
import type {
  JpegBlockGeometry,
  JpegSelectionGrid,
} from "./jpeg/block-geometry";
import { copySpatialMask, type SpatialMask } from "./document/masks";
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
  GestureContext,
  GestureOutcome,
  MaskTool,
} from "./features/effects/types";
import { MASK_TOOL_REGISTRY } from "./features/canvas-tools/registry";
import type { MaskCommitTrigger } from "./features/canvas-tools/types";
import { isJpegOperationController } from "./features/effects/types";
import { EffectCatalogPanel } from "./ui/effect-catalog-panel";
import { CanvasToolbar } from "./ui/canvas-toolbar";
import { bindEffectCanvasInteraction } from "./ui/canvas-interactions";
import { ImageOverlays } from "./ui/image-overlays";
import { useCanvasInteraction } from "./ui/use-canvas-interaction";
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
  const jpegOperations =
    historyDocument?.currentState.jpegOperations ?? EMPTY_JPEG_OPERATIONS;
  const activeMask = globalSelectionMask;
  const activeEffect = getEffect(activeEffectId ?? DEFAULT_EFFECT_ID);
  const activeView = activeEffect?.view;
  const activeSettings = activeView ? effectSettings[activeView.id] : undefined;
  const isMaskEffect = activeView?.interaction === "mask";
  const activeGestures = activeEffect
    ? isJpegOperationController(activeEffect.controller)
      ? activeEffect.controller.gestures
      : undefined
    : undefined;
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
  const gestureContext: GestureContext<ErasedSettings> | null =
    document && activeSettings
      ? {
          inspection: document.inspection,
          componentIndex,
          settings: activeSettings,
        }
      : null;
  const effectInteraction =
    toolMode === "effect" && activeGestures && gestureContext
      ? bindEffectCanvasInteraction(
          activeGestures,
          gestureContext,
          applyGestureOutcome,
        )
      : null;
  const {
    bindStage,
    bindImage,
    pointerHandlers,
    keyboardHandlers,
    cancel: cancelCanvas,
    setSpacePan,
    draft: canvasDraft,
    brushCursor,
    keyboardCursor,
    isPanning,
    hint: canvasHint,
    announcement: canvasAnnouncement,
    announce: announceCanvas,
  } = useCanvasInteraction({
    inspection: document?.inspection,
    orientation,
    tool: toolMode,
    componentIndex,
    grid: maskGrid,
    brushSize,
    effectInteraction,
    onCommitMask: commitMask,
    onError: setErrorMessage,
  });
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
    cancelCanvas();
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
      const mask = MASK_TOOL_REGISTRY.all.controller.createMask(
        result.value.inspection,
      );
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

    cancelCanvas();
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

  function selectAllImage() {
    if (!document) return;
    cancelCanvas();
    const mask = MASK_TOOL_REGISTRY.all.controller.createMask(
      document.inspection,
    );
    if (!mask.ok) {
      setErrorMessage(mask.error.message);
      return;
    }
    commitMask(mask.value, "command");
    announceCanvas("Selected the entire image.");
  }

  function activateTool(tool: MaskTool) {
    if (!document || !enabledCanvasTools.has(tool)) return;
    dispatchWorkspace({ type: "activate-tool", tool });
    const entry = MASK_TOOL_REGISTRY[tool];
    if (entry.kind === "command") selectAllImage();
    else {
      cancelCanvas();
      announceCanvas(`${entry.view.label} tool selected.`);
    }
    if (activeToolPanel.current) activeToolPanel.current.open = true;
  }

  function changeMaskGrid(grid: JpegSelectionGrid) {
    if (grid === maskGrid) return;
    cancelCanvas();
    setMaskGrid(grid);
  }

  function activateEffect(effectId: string) {
    const effect = getEffect(effectId);
    if (!effect) return;
    cancelCanvas();
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
    if (persist && activeGestures) cancelCanvas();
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

  function applyGestureOutcome(outcome: GestureOutcome<ErasedSettings>) {
    const { patch } = outcome;
    if (patch && activeView) {
      const { id } = activeView;
      setEffectSettings((current) => ({
        ...current,
        [id]: mergeSettings(current[id] ?? {}, patch),
      }));
    }
    if (outcome.error !== undefined) setErrorMessage(outcome.error);
    if (outcome.apply) applyEffect(patch);
  }

  function runTopBarAction(action: EffectTopBarAction<object>) {
    if (action.disabled) return;
    cancelCanvas();
    changeEffectSettings(action.patch, false);
    setErrorMessage("");
  }

  function changeComponent(index: number) {
    if (index === componentIndex) return;
    cancelCanvas();
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

  function commitMask(mask: SpatialMask | null, trigger: MaskCommitTrigger) {
    setErrorMessage("");
    dispatchWorkspace({ type: "set-selection", selection: mask });
    if (mask && trigger !== "command" && autoApplySelectionEffect(mask)) {
      dispatchWorkspace({ type: "set-selection", selection: null });
    }
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
    cancelCanvas();
    commitMask(null, "command");
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
    cancelCanvas();
    commitMask(restored.value, "command");
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
  const rectangleDraft =
    canvasDraft?.kind === "rectangle" ? canvasDraft.selection : null;
  const brushDraft = canvasDraft?.kind === "brush" ? canvasDraft : null;
  const visibleSelection = overlayVisibility.mask
    ? (rectangleDraft ?? getRectangleSelection(activeMaskForOverlay))
    : null;
  const gestureOverlay =
    activeGestures && gestureContext
      ? activeGestures.getOverlay(gestureContext)
      : null;
  const activeToolLabel = activeView?.label ?? "Effect settings";
  const toolbarTools = activeView?.toolbar.tools ?? [];
  const enabledCanvasTools: ReadonlySet<MaskTool> = isMaskEffect
    ? new Set(toolbarTools)
    : NO_TOOLS;
  const needsCanvasMask = !activeMask && isMaskEffect;
  const suggestedCanvasTools = needsCanvasMask ? enabledCanvasTools : NO_TOOLS;
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
      if (event.defaultPrevented || saveDialogRef.current?.open) return;
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
        setSpacePan(true);
        return;
      }

      const shortcut = getWorkspaceShortcut(event);
      if (shortcut === "select-all") {
        if (toolMode !== "select" || !document) return;
        event.preventDefault();
        selectAllImage();
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
            enabledCanvasTools.has(id) &&
            MASK_TOOL_REGISTRY[id].view.shortcut === key,
        );
        if (!tool) return;
        event.preventDefault();
        if (!event.repeat) activateTool(tool);
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
      if (event.code === "Space") setSpacePan(false);
    }

    window.addEventListener("keydown", onWorkspaceKeyDown);
    window.addEventListener("keyup", onWorkspaceKeyUp);
    return () => {
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
                    activeTool={toolMode === "effect" ? "all" : toolMode}
                    enabledTools={enabledCanvasTools}
                    suggestedTools={suggestedCanvasTools}
                    showSnapGrid={activeView?.toolbar.showSnapGrid ?? false}
                    actions={topBarActions}
                    onAction={runTopBarAction}
                    brushSize={brushSize}
                    onChangeBrushSize={setBrushSize}
                    maskGrid={maskGrid}
                    onChangeMaskGrid={changeMaskGrid}
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
                {canvasHint && (
                  <p id="canvas-tool-hint" className="canvas-keyboard-help">
                    {canvasHint.text}
                    {canvasHint.keyboard && ` ${canvasHint.keyboard}`}
                  </p>
                )}
                <div
                  className="image-stage"
                  ref={bindStage}
                  {...pointerHandlers}
                >
                  <div
                    className={`preview-image-wrap ${toolMode === "select" ? "is-selecting" : ""} ${toolMode === "brush" ? "is-brushing" : ""} ${isPanning ? "is-panning" : ""} ${toolMode === "effect" && activeGestures ? "is-block-transforming" : ""}`}
                    style={{ transform: `scale(${zoom})` }}
                    role="group"
                    tabIndex={0}
                    aria-label="JPEG image canvas"
                    aria-describedby={
                      canvasHint ? "canvas-tool-hint" : undefined
                    }
                    aria-keyshortcuts={
                      toolMode === "select" ? "Control+A Meta+A" : undefined
                    }
                    {...keyboardHandlers}
                    ref={bindImage}
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
                      brushDraft={brushDraft?.strokes ?? []}
                      brushCursorPoint={brushCursor}
                      brushRadius={brushDraft?.radius ?? brushSize / 2}
                      componentId={
                        document.inspection.components[componentIndex]?.id ?? -1
                      }
                      keyboardCursor={keyboardCursor}
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
                <span
                  className="visually-hidden"
                  role="status"
                  aria-live="polite"
                >
                  {canvasAnnouncement}
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
