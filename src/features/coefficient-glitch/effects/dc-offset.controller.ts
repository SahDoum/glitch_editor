import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import type { EffectController } from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { DcOffsetView } from "./dc-offset.view";

export class DcOffsetEffectController extends CoefficientEffectController {
  constructor() {
    super(DcOffsetView);
  }
}

export const DcOffsetEffect: EffectController<CoefficientRecipeStep> =
  new DcOffsetEffectController();
