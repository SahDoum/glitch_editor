import {
  previewDimensions,
  previewPointToFrame,
} from "../application/preview-orientation";
import type {
  CanvasGesture,
  CanvasPointerInput,
  CanvasToolHint,
  ImageSample,
} from "../features/canvas-tools/types";
import type {
  EffectGestureController,
  GestureContext,
  GestureOutcome,
  ImagePoint,
} from "../features/effects/types";
import type { JpegOrientation } from "../jpeg/orientation";
import type { JpegInspection } from "../jpeg/inspect";

export interface CanvasInteraction {
  begin(input: CanvasPointerInput): CanvasGesture | null;
  getHint(): CanvasToolHint | null;
}

export function clientPointToImage(
  client: ImagePoint,
  bounds: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  inspection: Pick<JpegInspection, "width" | "height">,
  orientation: JpegOrientation,
): ImageSample | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const dimensions = previewDimensions(inspection, orientation);
  const point = previewPointToFrame(
    ((client.x - bounds.left) / bounds.width) * dimensions.width,
    ((client.y - bounds.top) / bounds.height) * dimensions.height,
    inspection.width,
    inspection.height,
    orientation,
  );
  return {
    point,
    inside:
      point.x >= 0 &&
      point.x <= inspection.width &&
      point.y >= 0 &&
      point.y <= inspection.height,
  };
}

export function bindEffectCanvasInteraction<Settings extends object>(
  controller: EffectGestureController<Settings>,
  context: GestureContext<Settings>,
  onOutcome: (outcome: GestureOutcome<Settings>) => void,
): CanvasInteraction {
  return {
    begin({ image }) {
      if (!image?.inside) return null;
      // Pin the document and effect settings to the gesture. Apply the final
      // patch before React publishes a new render with the updated settings.
      let current = context;
      function handle(outcome: GestureOutcome<Settings>) {
        if (outcome.patch) {
          current = {
            ...current,
            settings: { ...current.settings, ...outcome.patch },
          };
        }
        onOutcome(outcome);
      }

      const start = controller.begin(current, image.point);
      handle(start.outcome);
      const gesture = start.gesture;
      if (!gesture) return null;
      return {
        move(input) {
          if (input.image)
            handle(
              gesture.move(current, input.image.point, input.image.inside),
            );
        },
        end(input) {
          handle(
            gesture.end(
              current,
              input.image?.point ?? null,
              input.image?.inside ?? false,
            ),
          );
        },
        cancel() {
          handle({ patch: gesture.cancel() });
        },
      };
    },
    getHint: () => controller.getHint(context),
  };
}
