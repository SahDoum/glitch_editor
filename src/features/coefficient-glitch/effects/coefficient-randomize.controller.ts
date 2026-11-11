import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { CoefficientRandomizeView } from "./coefficient-randomize.view";

export class CoefficientRandomizeEffectController extends CoefficientEffectController {
  constructor() {
    super(CoefficientRandomizeView);
  }
}

export const CoefficientRandomizeEffect: EffectController<CoefficientRecipeStep> =
  new CoefficientRandomizeEffectController();
