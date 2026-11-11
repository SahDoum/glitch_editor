import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { PosterizationView } from "./posterization.view";

export class PosterizationEffectController extends CoefficientEffectController {
  constructor() {
    super(PosterizationView);
  }
}

export const PosterizationEffect: EffectController<CoefficientRecipeStep> =
  new PosterizationEffectController();
