import type {
  CanvasContext,
  CanvasGesture,
  CanvasInteraction,
  CanvasPointerInput,
} from "../features/canvas-tools/types";
import type {
  EffectGestureController,
  GestureContext,
  GestureOutcome,
} from "../features/effects/types";

/** Bind the effect's gesture and presentation to one settings owner. */
export class EffectCanvasInteraction<
  Settings extends object,
> implements CanvasInteraction {
  readonly canvasClass = "is-block-transforming";

  constructor(
    private readonly controller: EffectGestureController<Settings>,
    private readonly context: GestureContext<Settings>,
    private readonly ownerId: string,
  ) {}

  getHint() {
    return this.controller.getHint(this.context);
  }

  getOverlay() {
    return this.controller.getOverlay(this.context);
  }

  begin(
    { image }: CanvasPointerInput,
    { publish }: CanvasContext,
  ): CanvasGesture | null {
    if (!image?.inside) return null;
    const { context, controller, ownerId } = this;
    const { gesture, outcome } = controller.begin(context, image.point);
    let settings = context.settings;
    function update(next: GestureOutcome<Settings>) {
      if (next.patch) settings = { ...settings, ...next.patch };
      publish({
        effect: { ownerId, patch: next.patch, apply: next.apply },
        error: next.error,
      });
    }
    update(outcome);
    if (!gesture) return null;
    return {
      move({ image }) {
        if (image)
          update(
            gesture.move({ ...context, settings }, image.point, image.inside),
          );
      },
      end({ image }) {
        update(
          gesture.end(
            { ...context, settings },
            image?.point ?? null,
            image?.inside ?? false,
          ),
        );
      },
      cancel() {
        update({ patch: gesture.cancel() });
      },
    };
  }
}
