import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { coefficientOperation } from "../../../jpeg/codec-controllers/operations";
import type { CoefficientGlitchOperation } from "../../../operations/jpeg-glitch";
import type {
  EffectController,
  EffectOperationContext,
} from "../../effects/types";
import { CoefficientEffectController } from "../coefficient-effect-controller";
import { PixelateView } from "./pixelate.view";

export class PixelateEffectController extends CoefficientEffectController {
  readonly operation = coefficientOperation;
  protected readonly acceptedModes = ["zero"] as const;
  constructor() {
    super(PixelateView);
  }

  buildOperation(context: EffectOperationContext<CoefficientRecipeStep>) {
    const { componentIndex, mask } = context;
    return this.validateOperation(
      {
        kind: this.operation.kind,
        mode: "zero",
        componentIndex,
        mask,
        domain: "ac",
        frequencyBand: "all",
        strength: 0,
        seed: 1,
      },
      context,
    );
  }

  protected override acceptsOperation(
    operation: CoefficientGlitchOperation,
  ): boolean {
    return (
      operation.domain === "ac" &&
      operation.frequencyBand === "all" &&
      operation.strength === 0 &&
      operation.seed === 1
    );
  }
}

export const PixelateEffect: EffectController<CoefficientRecipeStep> =
  new PixelateEffectController();
