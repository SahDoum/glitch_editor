import { createFullImageMask } from "../../document/masks";
import type { JpegInspection } from "../../jpeg/inspect";
import type { CanvasContext, CanvasInteraction } from "./types";

export function createWholeImageMask({ width, height }: JpegInspection) {
  return createFullImageMask(width, height);
}

export function selectWholeImage(context: CanvasContext): void {
  const result = createWholeImageMask(context.inspection);
  if (result.ok) {
    context.publish({
      draft: null,
      selection: { mask: result.value, autoApply: false },
      announcement: "Selected the entire image.",
      error: "",
    });
  } else {
    context.publish({ error: result.error.message });
  }
}

export class AllTool implements CanvasInteraction {
  activate(context: CanvasContext): void {
    selectWholeImage(context);
  }

  begin(): null {
    return null;
  }

  getHint(): null {
    return null;
  }
}
