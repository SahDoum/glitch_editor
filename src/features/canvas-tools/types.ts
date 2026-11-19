import type { SpatialMask, SpatialSelection } from "../../document/masks";
import type { JpegSelectionGrid } from "../../jpeg/block-geometry";
import type { JpegInspection } from "../../jpeg/inspect";
import type { Result } from "../../shared/result";
import type { ImagePoint } from "../effects/types";

export interface ImageSample {
  readonly point: ImagePoint;
  readonly inside: boolean;
}

export interface CanvasPointerInput {
  readonly clientPoint: ImagePoint;
  readonly image: ImageSample | null;
}

export interface CanvasGesture {
  move(input: CanvasPointerInput): void;
  end(input: CanvasPointerInput): void;
  cancel(): void;
}

export interface CanvasToolHint {
  readonly text: string;
  readonly keyboard?: string;
}

export interface MaskToolContext {
  readonly inspection: JpegInspection;
  readonly componentIndex: number;
  readonly grid: JpegSelectionGrid;
  readonly brushSize: number;
}

export type MaskDraft =
  | { readonly kind: "rectangle"; readonly selection: SpatialSelection }
  | {
      readonly kind: "brush";
      readonly strokes: readonly (readonly ImagePoint[])[];
      readonly radius: number;
    };

export interface MaskGesture {
  move(sample: ImageSample): Result<void>;
  getDraft(): MaskDraft | null;
  end(sample: ImageSample | null): Result<SpatialMask | null>;
  cancel(): void;
}

export interface MaskToolController {
  begin(
    context: MaskToolContext,
    sample: ImageSample,
  ): Result<MaskGesture | null>;
  getHint(context: MaskToolContext): CanvasToolHint;
}

export type MaskCommitTrigger = "command" | "pointer" | "keyboard";
