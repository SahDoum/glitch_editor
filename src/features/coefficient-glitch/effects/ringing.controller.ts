import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { RingingView } from "./ringing.view";

export class RingingEffectController extends CoefficientEffectController {
  constructor() {
    super(RingingView);
  }
}

export const RingingEffect: EffectController<CoefficientRecipeStep> =
  new RingingEffectController();
