import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { EngravingView } from "./engraving.view";

export class EngravingEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = [
    "engrave-horizontal",
    "engrave-vertical",
  ] as const;
  constructor() {
    super(EngravingView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    if (
      settings.mode !== "engrave-horizontal" &&
      settings.mode !== "engrave-vertical"
    ) {
      return this.validateOperation(null, context);
    }
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: settings.mode,
        componentIndex,
        mask,
        domain: "ac",
        frequencyBand: "all",
        strength: settings.strength,
        seed: settings.seed,
      },
      context,
    );
  }
}

export const EngravingEffect: EffectController<CoefficientRecipeStep> =
  new EngravingEffectController();
