import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { ZeroView } from "./zero.view";

export class ZeroEffectController extends CoefficientEffectController {
  constructor() {
    super(ZeroView);
  }
}

export const ZeroEffect: EffectController<CoefficientRecipeStep> =
  new ZeroEffectController();
