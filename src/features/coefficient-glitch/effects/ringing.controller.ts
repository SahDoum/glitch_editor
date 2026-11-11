import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { RingingView } from "./ringing.view";

export class RingingEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["ringing-boost"] as const;
  constructor() {
    super(RingingView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "ringing-boost",
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

export const RingingEffect: EffectController<CoefficientRecipeStep> =
  new RingingEffectController();
