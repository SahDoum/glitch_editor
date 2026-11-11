import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcInvertView } from "./ac-invert.view";

export class AcInvertEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["invert"] as const;
  constructor() {
    super(AcInvertView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "invert",
        componentIndex,
        mask,
        domain: "ac",
        frequencyBand: settings.frequencyBand,
        strength: 0,
        seed: settings.seed,
      },
      context,
    );
  }
}

export const AcInvertEffect: EffectController<CoefficientRecipeStep> =
  new AcInvertEffectController();
