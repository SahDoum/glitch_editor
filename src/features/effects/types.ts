import type { ComponentType, ReactNode } from "react";
import type { CanvasToolHint } from "../canvas-tools/types";
import type { JpegEditableState } from "../../application/jpeg-document";
import type { CorruptedEncodedJpeg } from "../../application/scan-corruption";
import type {
  JpegColorModel,
  JpegComponentLabel,
} from "../../jpeg/color-model";
import type { JpegInspection } from "../../jpeg/inspect";
import type {
  ScanCorruptionParameters,
  ScanCorruptionReport,
} from "../../jpeg/scan-corruption";
import type { ScanDecodeDiagnostic } from "../../jpeg/scan-corruption-worker-protocol";
import type { ProjectDocument } from "../../document/model";
import type { SpatialMask, SpatialSelection } from "../../document/masks";
import type { OperationHistory } from "../../operations/history";
import type { JpegGlitchOperation } from "../../operations/jpeg-glitch";
import type { OperationController } from "../../jpeg/codec-controllers/controller";
import type { JsonValue } from "../../operations/schema";
import type { Result } from "../../shared/result";

export type EffectId =
  | "pixelate"
  | "zero"
  | "posterization"
  | "ringing"
  | "engraving"
  | "coefficient-randomize"
  | "ac-scale"
  | "dc-offset"
  | "ac-low-pass"
  | "ac-invert"
  | "ac-isolate"
  | "block-transfer"
  | "block-repeat"
  | "block-shuffle"
  | "local-shift"
  | "quantization"
  | "scan-corrupt";

export type ImagePoint = { readonly x: number; readonly y: number };

/** Canvas tools that author the shared mask. */
export type MaskTool = "all" | "brush" | "select";

/**
 * How an effect receives its target:
 * - `mask`: A/B/M tools author a mask before the effect runs;
 * - `gesture`: the effect's controller owns the pointer gestures;
 * - `panel`: only the settings panel drives the effect.
 */
export type EffectInteraction = "mask" | "gesture" | "panel";

export interface EffectToolbarConfig {
  readonly tools: readonly MaskTool[];
  readonly showSnapGrid: boolean;
}

export interface EffectTopBarAction<Settings> {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly shortcut?: string;
  readonly disabled: boolean;
  /** Settings change applied when the action is chosen. */
  readonly patch: Partial<Settings>;
}

export type OperationParameters = Readonly<Record<string, JsonValue>>;

/** How a view recognizes and presents the history entries it produced. */
export interface OperationDescriptor {
  readonly kinds: readonly string[];
  readonly title: string;
  /** Narrows shared kinds; absent means every operation of the kind matches. */
  matches?(parameters: OperationParameters): boolean;
  describe(parameters: OperationParameters): ReactNode;
}

export interface ScanCorruptionPanelState {
  readonly canApply: boolean;
  readonly isCorrupting: boolean;
  readonly hasScanCorruption: boolean;
  readonly hasJpegOperations: boolean;
  readonly reports: readonly ScanCorruptionReport[];
  readonly diagnostic: ScanDecodeDiagnostic | null;
  readonly previewError: string;
  readonly apply: (settings: ScanCorruptionParameters) => void;
  readonly updateLastStage: (settings: ScanCorruptionParameters) => void;
  readonly cancel: () => void;
}

/** Editor state and callbacks a view may read; none of it names an effect. */
export interface EffectEditor<Settings> {
  readonly assetKey: string;
  readonly inspection: JpegInspection;
  readonly operations: readonly JpegGlitchOperation[];
  readonly componentLabels: readonly JpegComponentLabel[];
  readonly colorModel: JpegColorModel | null;
  readonly imageUrl: string | null;
  readonly componentIndex: number;
  readonly hasMask: boolean;
  readonly isEncoding: boolean;
  readonly isPreviewing: boolean;
  readonly hasScanCorruption: boolean;
  readonly autoApply: boolean;
  readonly autoApplyDisabled: boolean;
  readonly scanCorruption: ScanCorruptionPanelState;
  readonly onChangeComponent: (index: number) => void;
  readonly onChangeAutoApply: (checked: boolean) => void;
  readonly onError: (message: string) => void;
  /** Builds and applies the effect from its settings plus an optional patch. */
  readonly apply: (patch?: Partial<Settings>) => void;
  readonly preview: (patch?: Partial<Settings>) => void;
  readonly discardPreview: () => void;
}

export interface EffectPanelProps<Settings> {
  readonly settings: Settings;
  readonly editor: EffectEditor<Settings>;
  readonly onChangeSettings: (patch: Partial<Settings>) => void;
}

export interface EffectSettingsStore<Settings> {
  read(
    storage: Pick<Storage, "getItem">,
  ): Result<Readonly<Record<string, Settings>>>;
  write(
    storage: Pick<Storage, "setItem">,
    entries: Readonly<Record<string, Settings>>,
  ): Result<undefined>;
}

/** What the user sees and touches for one effect. */
export interface EffectView<Settings> {
  readonly id: EffectId;
  readonly label: string;
  readonly description: string;
  readonly category: string;
  readonly iconPaths: readonly string[];
  readonly interaction: EffectInteraction;
  readonly toolbar: EffectToolbarConfig;
  /** Offers "Apply while painting" and debounced preview after mask edits. */
  readonly autoApply: boolean;
  readonly autoPreview: boolean;
  readonly defaultSettings: Settings;
  /** Persists user-edited settings; absent when settings are session-only. */
  readonly settingsStore?: EffectSettingsStore<Settings>;
  /**
   * Key for persisted settings and automatic-apply state, when it must differ
   * from `id` so data saved before the registry existed stays readable.
   */
  readonly storageKey?: string;
  /** History presentation; absent for effects outside the operation history. */
  readonly operation?: OperationDescriptor;
  readonly Panel: ComponentType<EffectPanelProps<Settings>>;
  getTopBarActions?(
    settings: Settings,
  ): readonly EffectTopBarAction<Settings>[];
  /** Settings that depend on the component grid are cleared when it changes. */
  resetForComponentChange?(settings: Settings): Settings;
}

export interface EffectOperationContext<Settings> {
  readonly settings: Settings;
  readonly inspection: JpegInspection;
  readonly componentIndex: number;
  readonly mask: SpatialMask | null;
}

export interface GestureContext<Settings> {
  readonly settings: Settings;
  readonly inspection: JpegInspection;
  readonly componentIndex: number;
}

export interface GestureOutcome<Settings> {
  readonly patch?: Partial<Settings>;
  /** `undefined` leaves the message alone, `""` clears it. */
  readonly error?: string;
  /** Run the effect with the patched settings. */
  readonly apply?: boolean;
}

export interface EffectGesture<Settings> {
  move(
    context: GestureContext<Settings>,
    point: ImagePoint,
    inside: boolean,
  ): GestureOutcome<Settings>;
  end(
    context: GestureContext<Settings>,
    point: ImagePoint | null,
    inside: boolean,
  ): GestureOutcome<Settings>;
  cancel(): Partial<Settings>;
}

export interface GestureOverlay {
  readonly source: SpatialSelection | null;
  readonly sourceInvalid: boolean;
  readonly destination: SpatialSelection | null;
  readonly destinationInvalid: boolean;
}

export interface GestureStart<Settings> {
  /** `null` when the press cannot start a gesture (see `outcome.error`). */
  readonly gesture: EffectGesture<Settings> | null;
  readonly outcome: GestureOutcome<Settings>;
}

/** Pointer handling for a `gesture` effect, parallel to the brush/select tools. */
export interface EffectGestureController<Settings> {
  begin(
    context: GestureContext<Settings>,
    point: ImagePoint,
  ): GestureStart<Settings>;
  getOverlay(context: GestureContext<Settings>): GestureOverlay | null;
  getHint(context: GestureContext<Settings>): CanvasToolHint | null;
}

interface EffectControllerBase<Settings> {
  readonly view: EffectView<Settings>;
}

/**
 * Coefficient, DQT and block effects. They only implement `apply`, so the
 * coefficient worker and operation history never see byte-domain work.
 */
export interface JpegOperationController<
  Settings,
> extends EffectControllerBase<Settings> {
  readonly operation: OperationController;
  readonly gestures?: EffectGestureController<Settings>;
  readonly execute_corrupt?: never;
  /** Single source of truth for Preview and Apply parameters. */
  buildOperation(
    context: EffectOperationContext<Settings>,
  ): Result<JpegGlitchOperation>;
  apply(
    history: OperationHistory<JpegEditableState>,
    rawParameters: unknown,
    inspection: JpegInspection,
  ): Result<ProjectDocument<JpegEditableState>>;
}

/**
 * Scan Corrupt edits encoded bytes with its own history and worker. It
 * implements `execute_corrupt` and deliberately has no `apply`.
 */
export interface ScanCorruptionController<
  Settings,
> extends EffectControllerBase<Settings> {
  readonly apply?: never;
  readonly gestures?: never;
  toParameters(settings: Settings): ScanCorruptionParameters;
  settingsFromReport(report: ScanCorruptionReport): Settings;
  execute_corrupt(
    cleanEncodedBytes: Uint8Array,
    stages: readonly ScanCorruptionParameters[],
    signal?: AbortSignal,
  ): Promise<Result<CorruptedEncodedJpeg>>;
}

export type EffectController<Settings> =
  JpegOperationController<Settings> | ScanCorruptionController<Settings>;

export function isJpegOperationController<Settings>(
  controller: EffectController<Settings>,
): controller is JpegOperationController<Settings> {
  return "apply" in controller && typeof controller.apply === "function";
}

export function isScanCorruptionController<Settings>(
  controller: EffectController<Settings>,
): controller is ScanCorruptionController<Settings> {
  return (
    "execute_corrupt" in controller &&
    typeof controller.execute_corrupt === "function"
  );
}

export interface EffectMenuGroup {
  readonly heading: string;
  readonly effectIds: readonly EffectId[];
}
