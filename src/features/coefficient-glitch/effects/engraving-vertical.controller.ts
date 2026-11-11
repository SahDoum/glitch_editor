import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { EngravingVerticalView } from "./engraving-vertical.view";

export class EngravingVerticalEffectController extends CoefficientEffectController {
  constructor() {
    super(EngravingVerticalView);
  }
}

export const EngravingVerticalEffect: EffectController<CoefficientRecipeStep> =
  new EngravingVerticalEffectController();
