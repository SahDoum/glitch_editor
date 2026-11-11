import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { PosterizationView } from "./posterization.view";

export class PosterizationEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["dc-steps"] as const;
  constructor() {
    super(PosterizationView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "dc-steps",
        componentIndex,
        mask,
        domain: "dc",
        frequencyBand: "all",
        strength: settings.strength,
        seed: settings.seed,
      },
      context,
    );
  }
}

export const PosterizationEffect: EffectController<CoefficientRecipeStep> =
  new PosterizationEffectController();
