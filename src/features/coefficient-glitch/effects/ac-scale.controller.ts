import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcScaleView } from "./ac-scale.view";

export class AcScaleEffectController extends CoefficientEffectController {
  constructor() {
    super(AcScaleView);
  }
}

export const AcScaleEffect: EffectController<CoefficientRecipeStep> =
  new AcScaleEffectController();
