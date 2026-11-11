import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { CoefficientGlitchMode } from "../../../operations/jpeg-glitch";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { EngravingView } from "./engraving.view";

export class EngravingEffectController extends CoefficientEffectController {
  constructor() {
    super(EngravingView);
  }

  protected override acceptsMode(mode: CoefficientGlitchMode): boolean {
    return mode === "engrave-horizontal" || mode === "engrave-vertical";
  }
}

export const EngravingEffect: EffectController<CoefficientRecipeStep> =
  new EngravingEffectController();
