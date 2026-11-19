import {
  createBrushMaskFromStrokes,
  MAX_BRUSH_POINTS,
} from "../../document/masks";
import { snapImagePointToGrid } from "../../jpeg/block-geometry";
import { failure, success, type Result } from "../../shared/result";
import { openMaskGesture } from "./mask-gesture";
import type {
  CanvasContext,
  CanvasInteraction,
  CanvasPointerInput,
  ImagePoint,
  ImageSample,
  MaskGesture,
  MaskToolContext,
} from "./types";

export class BrushTool implements CanvasInteraction {
  begin({ image }: CanvasPointerInput, context: CanvasContext) {
    return image ? openMaskGesture(this.start(context, image), context) : null;
  }

  private start(
    { inspection, componentIndex, grid, brushSize }: MaskToolContext,
    sample: ImageSample,
  ): Result<MaskGesture | null> {
    if (!sample.inside) return success(null);
    const component = inspection.components[componentIndex];
    if (!component) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG component is invalid.",
      });
    }
    const componentId = component.id;
    const first = snapImagePointToGrid(
      sample.point,
      inspection,
      componentId,
      grid,
    );
    if (!first.ok) return first;
    const radius = brushSize / 2;
    const spacing = Math.max(1, brushSize / 8);
    const strokes: ImagePoint[][] = [[first.value]];
    let totalPoints = 1;
    let cancelled = false;

    function addSample({ point, inside }: ImageSample): Result<void> {
      if (cancelled) return success(undefined);
      const stroke = strokes[strokes.length - 1]!;
      if (!inside) {
        if (stroke.length > 0) strokes.push([]);
        return success(undefined);
      }

      const snapped = snapImagePointToGrid(
        point,
        inspection,
        componentId,
        grid,
      );
      if (!snapped.ok) return snapped;
      const previous = stroke[stroke.length - 1];
      const distance = previous
        ? Math.hypot(snapped.value.x - previous.x, snapped.value.y - previous.y)
        : null;
      const steps = distance === null ? 1 : Math.ceil(distance / spacing);
      if (totalPoints + steps > MAX_BRUSH_POINTS) {
        cancelled = true;
        return failure({
          code: "INVALID_INPUT",
          message:
            "This brush stroke is too long. Finish it in shorter strokes.",
        });
      }
      if (!previous) stroke.push(snapped.value);
      else {
        for (let step = 1; step <= steps; step += 1) {
          const ratio = step / steps;
          stroke.push({
            x: previous.x + (snapped.value.x - previous.x) * ratio,
            y: previous.y + (snapped.value.y - previous.y) * ratio,
          });
        }
      }
      totalPoints += steps;
      return success(undefined);
    }

    return success({
      move: addSample,
      getDraft: () =>
        cancelled
          ? null
          : {
              kind: "brush",
              strokes: strokes.map((stroke) => [...stroke]),
              radius,
            },
      end(point) {
        if (cancelled) return success(null);
        const added = point && addSample(point);
        if (added && !added.ok) return added;
        return createBrushMaskFromStrokes(
          strokes,
          radius,
          inspection.width,
          inspection.height,
        );
      },
      cancel() {
        cancelled = true;
      },
    });
  }

  getHint({ grid }: MaskToolContext) {
    const gridLabel = grid === "mcu" ? "MCUs" : "DCT blocks";
    return {
      text: `Paint over the image, then release to finish the brush mask snapped to ${gridLabel}.`,
    };
  }

  hover(sample: ImageSample | null, context: CanvasContext): void {
    context.publish({ hoverPoint: sample?.inside ? sample.point : null });
  }
}
