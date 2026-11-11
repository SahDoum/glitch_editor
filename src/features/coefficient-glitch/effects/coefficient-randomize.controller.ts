import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { CoefficientRandomizeView } from "./coefficient-randomize.view";

export class CoefficientRandomizeEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["randomize"] as const;
  constructor() {
    super(CoefficientRandomizeView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { settings, componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "randomize",
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

export const CoefficientRandomizeEffect: EffectController<CoefficientRecipeStep> =
  new CoefficientRandomizeEffectController();
