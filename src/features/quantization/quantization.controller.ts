import {
  applyQuantizationOperation,
  type JpegEditableState,
} from "../../application/jpeg-document";
import {
  isQuantizationParameters,
  type QuantizationOperation,
} from "../../operations/jpeg-glitch";
import type { OperationHistory } from "../../operations/history";
import type { JpegInspection } from "../../jpeg/inspect";
import type { ProjectDocument } from "../../document/model";
import { failure, success, type Result } from "../../shared/result";
import type {
  EffectOperationContext,
  JpegOperationController,
} from "../effects/types";
import {
  QuantizationView,
  type QuantizationSettings,
} from "./quantization.view";

export class QuantizationController implements JpegOperationController<QuantizationSettings> {
  declare readonly execute_corrupt?: never;
  readonly view = QuantizationView;

  buildOperation({
    settings,
    inspection,
  }: EffectOperationContext<QuantizationSettings>): Result<QuantizationOperation> {
    const operation: QuantizationOperation = {
      kind: "quantization",
      tableId: settings.tableId,
      values: settings.values,
      semantics: settings.semantics,
      pattern: settings.pattern,
      seed: settings.seed,
    };
    return isQuantizationParameters(operation, inspection)
      ? success(operation)
      : failure({
          code: "INVALID_INPUT",
          message: "The current DQT settings are invalid.",
        });
  }

  execute(
    history: OperationHistory<JpegEditableState>,
    rawParameters: unknown,
    inspection: JpegInspection,
  ): Result<ProjectDocument<JpegEditableState>> {
    if (!isQuantizationParameters(rawParameters, inspection)) {
      return failure({
        code: "INVALID_INPUT",
        message:
          "The quantization edit must select an existing table and contain 64 integer values from 1 to 255.",
      });
    }
    return applyQuantizationOperation(history, rawParameters);
  }
}

export const QuantizationEffect = new QuantizationController();
