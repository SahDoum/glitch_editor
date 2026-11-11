import { applyBlockShiftOperation } from "../../../application/jpeg-document";
import {
  isBlockShiftParameters,
  type BlockShiftOperation,
} from "../../../operations/jpeg-glitch";
import { failure, success, type Result } from "../../../shared/result";
import type { EffectOperationContext } from "../../effects/types";
import { BlockEffectController } from "../block-effect-controller";
import { LocalShiftView, type LocalShiftSettings } from "./local-shift.view";

export class LocalShiftController extends BlockEffectController<
  LocalShiftSettings,
  BlockShiftOperation
> {
  constructor() {
    super(
      LocalShiftView,
      isBlockShiftParameters,
      applyBlockShiftOperation,
      "The block shift parameters, component, or mask are invalid.",
    );
  }

  buildOperation({
    settings,
    inspection,
    componentIndex,
    mask,
  }: EffectOperationContext<LocalShiftSettings>): Result<BlockShiftOperation> {
    if (!mask) {
      return failure({
        code: "INVALID_INPUT",
        message: "Draw or select a mask before shifting DCT blocks.",
      });
    }
    const operation: BlockShiftOperation = {
      kind: "block-shift",
      componentIndex,
      mask,
      offsetX: settings.x,
      offsetY: settings.y,
    };
    return isBlockShiftParameters(operation, inspection)
      ? success(operation)
      : failure({
          code: "INVALID_INPUT",
          message: "The current local-shift settings are invalid.",
        });
  }
}

export const LocalShiftEffect = new LocalShiftController();
