import type { JpegEditableState } from "../../application/jpeg-document";
import type { JpegGlitchOperation } from "../../operations/jpeg-glitch";
import type { OperationHistory } from "../../operations/history";
import type { JpegInspection } from "../../jpeg/inspect";
import type { OperationController } from "../../jpeg/codec-controllers/controller";
import type { ProjectDocument } from "../../document/model";
import { failure, type Result } from "../../shared/result";
import type {
  EffectGestureController,
  EffectOperationContext,
  EffectView,
  JpegOperationController,
} from "../effects/types";

export abstract class BlockEffectController<
  Settings,
  Operation extends JpegGlitchOperation,
> implements JpegOperationController<Settings> {
  declare readonly execute_corrupt?: never;
  readonly gestures?: EffectGestureController<Settings>;

  constructor(
    readonly view: EffectView<Settings>,
    readonly operation: OperationController<Operation["kind"]>,
    private readonly isValid: (
      value: unknown,
      inspection: JpegInspection,
    ) => value is Operation,
    private readonly applyOperation: (
      history: OperationHistory<JpegEditableState>,
      operation: Operation,
    ) => Result<ProjectDocument<JpegEditableState>>,
    private readonly invalidMessage: string,
  ) {}

  abstract buildOperation(
    context: EffectOperationContext<Settings>,
  ): Result<Operation>;

  apply(
    history: OperationHistory<JpegEditableState>,
    rawParameters: unknown,
    inspection: JpegInspection,
  ): Result<ProjectDocument<JpegEditableState>> {
    if (!this.isValid(rawParameters, inspection)) {
      return failure({ code: "INVALID_INPUT", message: this.invalidMessage });
    }
    return this.applyOperation(history, rawParameters);
  }
}
