import type {
  CanvasFeedback,
  ImagePoint,
  MaskDraft,
} from "../features/canvas-tools/types";
import type { JpegBlockCoordinate } from "../jpeg/block-geometry";

interface CanvasVisualSnapshot {
  readonly draft: MaskDraft | null;
  readonly hoverPoint: ImagePoint | null;
  readonly keyboardCursor: JpegBlockCoordinate | null;
}

const EMPTY: CanvasVisualSnapshot = Object.freeze({
  draft: null,
  hoverPoint: null,
  keyboardCursor: null,
});

/** Pointer-frequency presentation state, subscribed to only by the canvas overlay. */
export class CanvasVisualState {
  private current = EMPTY;
  private readonly listeners = new Set<() => void>();
  getSnapshot = (): CanvasVisualSnapshot => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  publish(feedback: CanvasFeedback): void {
    const next = {
      draft: feedback.draft === undefined ? this.current.draft : feedback.draft,
      hoverPoint:
        feedback.hoverPoint === undefined
          ? this.current.hoverPoint
          : feedback.hoverPoint,
      keyboardCursor:
        feedback.keyboardCursor === undefined
          ? this.current.keyboardCursor
          : feedback.keyboardCursor,
    };
    if (
      next.draft === this.current.draft &&
      next.hoverPoint === this.current.hoverPoint &&
      next.keyboardCursor === this.current.keyboardCursor
    )
      return;
    this.current = Object.freeze(next);
    for (const listener of this.listeners) listener();
  }
  reset(): void {
    this.publish(EMPTY);
  }
}
