import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcScaleView } from "./ac-scale.view";

export class AcScaleEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["scale"] as const;
  constructor() {
    super(AcScaleView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "scale",
        componentIndex,
        mask,
        domain: settings.domain,
        frequencyBand: settings.frequencyBand,
        strength: settings.strength,
        seed: settings.seed,
      },
      context,
    );
  }
}

export const AcScaleEffect: EffectController<CoefficientRecipeStep> =
  new AcScaleEffectController();
