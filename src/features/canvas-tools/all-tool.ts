import { createFullImageMask } from "../../document/masks";
import type { JpegInspection } from "../../jpeg/inspect";

export class AllTool {
  createMask({ width, height }: JpegInspection) {
    return createFullImageMask(width, height);
  }
}
