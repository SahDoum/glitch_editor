import type { SpatialMask, SpatialSelection } from "../../document/masks";
import type {
  JpegBlockCoordinate,
  JpegSelectionGrid,
} from "../../jpeg/block-geometry";
import type { JpegInspection } from "../../jpeg/inspect";
import type { JpegOrientation } from "../../jpeg/orientation";
import type { Result } from "../../shared/result";

export type { MaskTool } from "./registry";

export type ImagePoint = { readonly x: number; readonly y: number };

/** A point mapped into the source JPEG frame. Select uses outside points for clipping. */
export interface ImageSample {
  readonly point: ImagePoint;
  readonly inside: boolean;
}

/** The same pointer event in viewport coordinates for pan and JPEG coordinates for editing. */
export interface CanvasPointerInput {
  readonly clientPoint: ImagePoint;
  /** Null when there is no image or the preview bounds cannot be measured. */
  readonly image: ImageSample | null;
}

/** A key press with the focus and gesture state the tool uses to decide whether to handle it. */
export interface CanvasKeyInput {
  readonly key: string;
  readonly repeat?: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly canvasFocused: boolean;
  readonly pointerActive: boolean;
}

/** Help for the current phase of a tool, shown by the editor next to the image. */
export interface CanvasToolHint {
  readonly text: string;
  readonly keyboard?: string;
}

/** One press-to-release session. CanvasPointer forwards moves and ends or cancels it once. */
export interface CanvasGesture {
  move(input: CanvasPointerInput): void;
  end(input: CanvasPointerInput): void;
  cancel(): void;
}

/** Source and destination outlines in JPEG image coordinates, with validity for styling. */
export interface CanvasOverlay {
  readonly source: SpatialSelection | null;
  readonly sourceInvalid: boolean;
  readonly destination: SpatialSelection | null;
  readonly destinationInvalid: boolean;
}

/** Read-only JPEG geometry and mask settings used for snapping and drawing. */
export interface MaskToolContext {
  readonly inspection: JpegInspection;
  readonly componentIndex: number;
  readonly grid: JpegSelectionGrid;
  /** Brush diameter in JPEG image pixels. */
  readonly brushSize: number;
}

/** In-progress rectangle or sampled brush strokes that the editor draws during a gesture. */
export type MaskDraft =
  | { readonly kind: "rectangle"; readonly selection: SpatialSelection }
  | {
      readonly kind: "brush";
      readonly strokes: readonly (readonly ImagePoint[])[];
      readonly radius: number;
    };

/**
 * Updates sent back to the editor by an interaction. An omitted field leaves its
 * state alone. A null draft, cursor, or selection mask clears the corresponding state.
 */
export interface CanvasFeedback {
  readonly draft?: MaskDraft | null;
  readonly keyboardCursor?: JpegBlockCoordinate | null;
  readonly hoverPoint?: ImagePoint | null;
  readonly selection?: {
    readonly mask: SpatialMask | null;
    /** Let the editor apply the active effect if its Auto Apply setting is enabled. */
    readonly autoApply: boolean;
  };
  /** Route an effect's settings patch and optional Apply request to its owner. */
  readonly effect?: {
    readonly ownerId: string;
    readonly patch?: object;
    readonly apply?: boolean;
  };
  readonly announcement?: string;
  readonly error?: string;
}

/**
 * Editor state and callbacks passed to the active tool when handling input.
 * Geometry and settings drive its calculations. publish sends a result back
 * to the editor, and cancelGesture lets a command such as Ctrl+A end a drag first.
 */
export interface CanvasContext extends MaskToolContext {
  readonly orientation: JpegOrientation;
  readonly keyboardCursor: JpegBlockCoordinate | null;
  cancelGesture(): void;
  publish(feedback: CanvasFeedback): void;
}

/**
 * Contract for the area that shows the JPEG and its overlays.
 * The editor resolves one active interaction and delegates input and hints to it.
 */
export interface CanvasInteraction {
  /** Start tracking a pointer. Returning null leaves the pointer uncaptured. */
  begin(
    input: CanvasPointerInput,
    context: CanvasContext,
  ): CanvasGesture | null;
  getHint(context: MaskToolContext): CanvasToolHint | null;
  getOverlay?(context: MaskToolContext): CanvasOverlay | null;
  readonly canvasClass?: string;
  /** Run a command on selection, such as All creating a whole-image mask. */
  activate?(context: CanvasContext): void;
  focus?(context: CanvasContext): void;
  getInitialCursor?(context: MaskToolContext): JpegBlockCoordinate | null;
  /** Return true when the editor should suppress the browser's default action. */
  handleKey?(input: CanvasKeyInput, context: CanvasContext): boolean;
  hover?(sample: ImageSample | null, context: CanvasContext): void;
  reset?(): void;
}

/** Brush/Select geometry session. openMaskGesture publishes its draft and final mask. */
export interface MaskGesture {
  move(sample: ImageSample): Result<void>;
  getDraft(): MaskDraft | null;
  end(sample: ImageSample | null): Result<SpatialMask | null>;
  cancel(): void;
}
