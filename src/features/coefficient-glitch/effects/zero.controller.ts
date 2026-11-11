import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { ZeroView } from "./zero.view";

export class ZeroEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["zero"] as const;
  constructor() {
    super(ZeroView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "zero",
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

export const ZeroEffect: EffectController<CoefficientRecipeStep> =
  new ZeroEffectController();
