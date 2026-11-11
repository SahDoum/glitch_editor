import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcInvertView } from "./ac-invert.view";

export class AcInvertEffectController extends CoefficientEffectController {
  constructor() {
    super(AcInvertView);
  }
}

export const AcInvertEffect: EffectController<CoefficientRecipeStep> =
  new AcInvertEffectController();
