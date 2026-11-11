import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcLowPassView } from "./ac-low-pass.view";

export class AcLowPassEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["low-pass"] as const;
  constructor() {
    super(AcLowPassView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "low-pass",
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

export const AcLowPassEffect: EffectController<CoefficientRecipeStep> =
  new AcLowPassEffectController();
