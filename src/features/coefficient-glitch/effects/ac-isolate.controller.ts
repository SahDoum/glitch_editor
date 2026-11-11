import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { AcIsolateView } from "./ac-isolate.view";

export class AcIsolateEffectController extends CoefficientEffectController {
  constructor() {
    super(AcIsolateView);
  }
}

export const AcIsolateEffect: EffectController<CoefficientRecipeStep> =
  new AcIsolateEffectController();
