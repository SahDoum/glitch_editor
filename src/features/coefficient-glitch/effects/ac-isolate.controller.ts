import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcIsolateView } from "./ac-isolate.view";

export class AcIsolateEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["isolate"] as const;
  constructor() {
    super(AcIsolateView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "isolate",
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

export const AcIsolateEffect: EffectController<CoefficientRecipeStep> =
  new AcIsolateEffectController();
