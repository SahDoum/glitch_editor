import { applyBlockPermutationOperation } from "../../../application/jpeg-document";
import {
  isBlockPermutationParameters,
  type BlockPermutationOperation,
} from "../../../operations/jpeg-glitch";
import { failure, success, type Result } from "../../../shared/result";
import type { EffectOperationContext } from "../../effects/types";
import { BlockEffectController } from "../block-effect-controller";
import {
  BlockShuffleView,
  type BlockShuffleSettings,
} from "./block-shuffle.view";

export class BlockShuffleController extends BlockEffectController<
  BlockShuffleSettings,
  BlockPermutationOperation
> {
  constructor() {
    super(
      BlockShuffleView,
      isBlockPermutationParameters,
      applyBlockPermutationOperation,
      "The block permutation parameters, component, mask, or seed are invalid.",
    );
  }

  buildOperation({
    settings,
    inspection,
    componentIndex,
    mask,
  }: EffectOperationContext<BlockShuffleSettings>): Result<BlockPermutationOperation> {
    if (!mask) {
      return failure({
        code: "INVALID_INPUT",
        message: "Draw or select a mask before permuting DCT blocks.",
      });
    }
    const operation: BlockPermutationOperation = {
      kind: "block-permutation",
      componentIndex,
      mask,
      seed: settings.seed,
    };
    return isBlockPermutationParameters(operation, inspection)
      ? success(operation)
      : failure({
          code: "INVALID_INPUT",
          message: "The current block-shuffle settings are invalid.",
        });
  }
}

export const BlockShuffleEffect = new BlockShuffleController();
