import {
  applyCoefficientGlitchOperation,
  type JpegEditableState,
} from "../../application/jpeg-document";
import type { CoefficientRecipeStep } from "../../application/experiment-recipes";
import {
  isCoefficientGlitchParameters,
  type CoefficientGlitchMode,
  type CoefficientGlitchOperation,
} from "../../operations/jpeg-glitch";
import type { OperationHistory } from "../../operations/history";
import type { JpegInspection } from "../../jpeg/inspect";
import type { ProjectDocument } from "../../document/model";
import { failure, success, type Result } from "../../shared/result";
import type {
  EffectOperationContext,
  EffectView,
  JpegOperationController,
} from "../effects/types";

/** Modes that ignore strength carry a canonical zero so snapshots compare. */
export function normalizeCoefficientStep(
  step: CoefficientRecipeStep,
): CoefficientRecipeStep {
  return step.mode === "invert" || step.mode === "isolate"
    ? { ...step, strength: 0 }
    : step;
}

export abstract class CoefficientEffectController implements JpegOperationController<CoefficientRecipeStep> {
  declare readonly execute_corrupt?: never;

  constructor(readonly view: EffectView<CoefficientRecipeStep>) {}

  /** Each effect owns which recorded modes it can execute. */
  protected acceptsMode(mode: CoefficientGlitchMode): boolean {
    return mode === this.view.defaultSettings.mode;
  }

  /** Effects with fixed behavior (for example Pixelate) override this. */
  protected getStep(settings: CoefficientRecipeStep): CoefficientRecipeStep {
    return normalizeCoefficientStep(settings);
  }

  buildOperation({
    settings,
    inspection,
    componentIndex,
    mask,
  }: EffectOperationContext<CoefficientRecipeStep>): Result<CoefficientGlitchOperation> {
    if (!mask) {
      return failure({
        code: "INVALID_INPUT",
        message: `Select an area before using ${this.view.label}.`,
      });
    }
    const operation = {
      kind: "coefficients",
      mask,
      componentIndex,
      ...this.getStep(settings),
    };
    if (!isCoefficientGlitchParameters(operation, inspection)) {
      return failure({
        code: "INVALID_INPUT",
        message: "The current coefficient settings are invalid.",
      });
    }
    return success(operation);
  }

  execute(
    history: OperationHistory<JpegEditableState>,
    rawParameters: unknown,
    inspection: JpegInspection,
  ): Result<ProjectDocument<JpegEditableState>> {
    if (!isCoefficientGlitchParameters(rawParameters, inspection)) {
      return failure({
        code: "INVALID_INPUT",
        message: "The coefficient glitch parameters or mask are invalid.",
      });
    }
    if (!this.acceptsMode(rawParameters.mode)) {
      return failure({
        code: "INVALID_INPUT",
        message: `The ${this.view.label} controller received parameters for a different coefficient effect.`,
      });
    }
    return applyCoefficientGlitchOperation(history, rawParameters);
  }
}
