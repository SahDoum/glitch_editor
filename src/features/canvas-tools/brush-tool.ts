import {
  createBrushMaskFromStrokes,
  MAX_BRUSH_POINTS,
} from "../../document/masks";
import { snapImagePointToGrid } from "../../jpeg/block-geometry";
import { failure, success, type Result } from "../../shared/result";
import type { ImagePoint } from "../effects/types";
import type {
  ImageSample,
  CanvasToolHint,
  MaskDraft,
  MaskGesture,
  MaskToolContext,
  MaskToolController,
} from "./types";

function snapPoint(
  context: MaskToolContext,
  point: ImagePoint,
): Result<ImagePoint> {
  const { inspection, componentIndex, grid } = context;
  const component = inspection.components[componentIndex];
  if (!component) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
    });
  }
  return snapImagePointToGrid(point, inspection, component.id, grid);
}

class BrushStroke implements MaskGesture {
  private readonly strokes: ImagePoint[][];
  private readonly radius: number;
  private pointCount = 1;
  private cancelled = false;

  constructor(
    private readonly context: MaskToolContext,
    start: ImagePoint,
  ) {
    this.radius = context.brushSize / 2;
    this.strokes = [[start]];
  }

  move(sample: ImageSample): Result<void> {
    if (this.cancelled) return success(undefined);
    const current = this.strokes.at(-1)!;
    if (!sample.inside) {
      if (current.length > 0) this.strokes.push([]);
      return success(undefined);
    }

    const snapped = snapPoint(this.context, sample.point);
    if (!snapped.ok) return snapped;
    const point = snapped.value;
    const previous = current.at(-1);
    const steps = previous
      ? Math.ceil(
          Math.hypot(point.x - previous.x, point.y - previous.y) /
            Math.max(1, this.radius / 4),
        )
      : 1;
    if (this.pointCount + steps > MAX_BRUSH_POINTS) {
      this.cancel();
      return failure({
        code: "INVALID_INPUT",
        message: "This brush stroke is too long. Finish it in shorter strokes.",
      });
    }
    if (previous) {
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        current.push({
          x: previous.x + (point.x - previous.x) * ratio,
          y: previous.y + (point.y - previous.y) * ratio,
        });
      }
    } else {
      current.push(point);
    }
    this.pointCount += steps;
    return success(undefined);
  }

  getDraft(): MaskDraft | null {
    if (this.cancelled) return null;
    return {
      kind: "brush",
      strokes: this.strokes.map((stroke) => [...stroke]),
      radius: this.radius,
    };
  }

  end(sample: ImageSample | null) {
    if (this.cancelled) return success(null);
    if (sample) {
      const moved = this.move(sample);
      if (!moved.ok) return moved;
    }
    const { width, height } = this.context.inspection;
    const mask = createBrushMaskFromStrokes(
      this.strokes,
      this.radius,
      width,
      height,
    );
    this.cancel();
    return mask;
  }

  cancel() {
    this.strokes.length = 0;
    this.cancelled = true;
  }
}

export class BrushTool implements MaskToolController {
  begin(context: MaskToolContext, sample: ImageSample) {
    if (!sample.inside) return success(null);
    const point = snapPoint(context, sample.point);
    return point.ok ? success(new BrushStroke(context, point.value)) : point;
  }

  getHint({ grid }: MaskToolContext): CanvasToolHint {
    const gridLabel = grid === "mcu" ? "MCUs" : "DCT blocks";
    return {
      text: `Paint over the image, then release to finish the brush mask snapped to ${gridLabel}.`,
    };
  }

  hover(sample: ImageSample | null) {
    return sample?.inside ? sample.point : null;
  }
}
