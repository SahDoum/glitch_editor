import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { PixelateView } from "./pixelate.view";

export class PixelateEffectController extends CoefficientEffectController {
  constructor() {
    super(PixelateView);
  }

  protected override getStep(): CoefficientRecipeStep {
    return this.view.defaultSettings;
  }
}

export const PixelateEffect: EffectController<CoefficientRecipeStep> =
  new PixelateEffectController();
