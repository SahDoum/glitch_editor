import type { Result } from "../../shared/result";
import type { CanvasContext, CanvasGesture, MaskGesture } from "./types";

/** Publish a tool's draft during the gesture and its mask only after release. */
export function openMaskGesture(
  result: Result<MaskGesture | null>,
  { publish }: CanvasContext,
): CanvasGesture | null {
  if (!result.ok) {
    publish({ error: result.error.message });
    return null;
  }
  const gesture = result.value;
  if (!gesture) return null;
  publish({ draft: gesture.getDraft() });
  return {
    move({ image }) {
      if (!image) return;
      const moved = gesture.move(image);
      publish({
        draft: gesture.getDraft(),
        error: moved.ok ? undefined : moved.error.message,
      });
    },
    end({ image }) {
      const finished = gesture.end(image);
      publish({
        draft: null,
        error: finished.ok ? undefined : finished.error.message,
        selection:
          finished.ok && finished.value
            ? { mask: finished.value, autoApply: true }
            : undefined,
      });
    },
    cancel() {
      gesture.cancel();
      publish({ draft: null });
    },
  };
}
