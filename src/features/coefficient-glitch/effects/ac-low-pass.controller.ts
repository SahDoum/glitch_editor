import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcLowPassView } from "./ac-low-pass.view";

export class AcLowPassEffectController extends CoefficientEffectController {
  constructor() {
    super(AcLowPassView);
  }
}

export const AcLowPassEffect: EffectController<CoefficientRecipeStep> =
  new AcLowPassEffectController();
