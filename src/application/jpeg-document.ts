import { createProjectDocument } from "../document/model";
import { spatialMaskToJson } from "../document/masks";
import type { ImportedJpeg } from "./import-jpeg";
import { OperationHistory } from "../operations/history";
import { type OperationRecord } from "../operations/schema";
import { failure, success, type Result } from "../shared/result";
import {
  isBlockRepeatParameters,
  isBlockPermutationParameters,
  isBlockShiftParameters,
  isBlockTransferParameters,
  isCoefficientGlitchParameters,
  isQuantizationParameters,
  MAX_GLITCH_OPERATIONS,
  type BlockRepeatOperation,
  type BlockPermutationOperation,
  type BlockShiftOperation,
  type BlockTransferOperation,
  type CoefficientGlitchOperation,
  type JpegGlitchOperation,
  type QuantizationOperation,
} from "../operations/jpeg-glitch";
import {
  getOperationController,
  isOperationList,
} from "../jpeg/codec-controllers/registry";
import type { JpegInspection } from "../jpeg/inspect";
import type { ProjectDocument } from "../document/model";

export interface JpegEditableState {
  readonly jpegOperations: readonly JpegGlitchOperation[];
}

/** Build the executable list once; history transitions validate before publication. */
export function planJpegOperations(
  operations: readonly OperationRecord[],
  inspection: JpegInspection,
): Result<JpegEditableState> {
  const jpegOperations: JpegGlitchOperation[] = [];
  for (const record of operations) {
    const controller = getOperationController(record.type);
    if (controller) {
      if (
        record.version !== 1 ||
        !controller.isOperation(record.parameters, inspection)
      ) {
        return failure({
          code: "INVALID_INPUT",
          message: "The JPEG operation parameters are invalid.",
        });
      }
      if (record.enabled) jpegOperations.push(record.parameters);
    } else {
      return failure({
        code: "INVALID_INPUT",
        message: "The saved JPEG operation is invalid or unsupported.",
      });
    }
  }
  if (!isOperationList(jpegOperations, inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The active JPEG operation plan exceeds the processing limit or contains invalid parameters.",
    });
  }
  return success(
    Object.freeze({
      jpegOperations: Object.freeze(jpegOperations),
    }),
  );
}

export function createJpegDocumentSession<
  T extends Pick<ImportedJpeg, "originalAsset" | "inspection">,
>(imported: T): Result<OperationHistory<JpegEditableState>> {
  const projectDocument = createProjectDocument(
    imported.originalAsset,
    imported.inspection,
    Object.freeze({
      jpegOperations: Object.freeze([]),
    }),
  );
  return success(
    new OperationHistory(projectDocument, undefined, (operations) =>
      planJpegOperations(operations, imported.inspection),
    ),
  );
}

function checkOperationLimit(
  history: OperationHistory<JpegEditableState>,
): Result<undefined> {
  if (
    history.snapshot.currentState.jpegOperations.length >= MAX_GLITCH_OPERATIONS
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: `A document supports at most ${MAX_GLITCH_OPERATIONS} JPEG glitch operations.`,
    });
  }
  return success(undefined);
}

export function applyCoefficientGlitchOperation(
  history: OperationHistory<JpegEditableState>,
  input: CoefficientGlitchOperation & { readonly seed: number },
): Result<ProjectDocument<JpegEditableState>> {
  const limit = checkOperationLimit(history);
  if (!limit.ok) return limit;
  const operation = {
    kind: input.kind,
    mask: spatialMaskToJson(input.mask),
    componentIndex: input.componentIndex,
    domain: input.domain,
    mode: input.mode,
    frequencyBand: input.frequencyBand,
    strength: input.strength,
    seed: input.seed,
  };
  if (!isCoefficientGlitchParameters(operation, history.snapshot.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The coefficient glitch parameters or mask are invalid.",
    });
  }
  if (
    !Number.isInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 0xffff_ffff
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "A random seed must be an unsigned 32-bit integer.",
    });
  }
  return history.add(
    input.kind,
    1,
    { ...operation },
    {
      seed: input.seed,
      maskId: input.mask.id,
    },
  );
}

export function applyBlockRepeatOperation(
  history: OperationHistory<JpegEditableState>,
  input: BlockRepeatOperation,
): Result<ProjectDocument<JpegEditableState>> {
  const limit = checkOperationLimit(history);
  if (!limit.ok) return limit;
  if (!isBlockRepeatParameters(input, history.snapshot.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The block repeat is outside the selected component. Check the source, direction, distance, and repeat count.",
    });
  }
  return history.add(input.kind, 1, {
    kind: input.kind,
    componentIndex: input.componentIndex,
    sourceX: input.sourceX,
    sourceY: input.sourceY,
    offsetX: input.offsetX,
    offsetY: input.offsetY,
    repetitions: input.repetitions,
  });
}

export function applyBlockPermutationOperation(
  history: OperationHistory<JpegEditableState>,
  input: BlockPermutationOperation,
): Result<ProjectDocument<JpegEditableState>> {
  const limit = checkOperationLimit(history);
  if (!limit.ok) return limit;
  const parameters = {
    kind: input.kind,
    componentIndex: input.componentIndex,
    mask: spatialMaskToJson(input.mask),
    seed: input.seed,
  };
  if (!isBlockPermutationParameters(parameters, history.snapshot.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The block permutation parameters, component, mask, or seed are invalid.",
    });
  }
  return history.add(
    input.kind,
    1,
    {
      kind: input.kind,
      componentIndex: input.componentIndex,
      mask: spatialMaskToJson(input.mask),
      seed: input.seed,
    },
    { seed: input.seed, maskId: input.mask.id },
  );
}

export function applyBlockTransferOperation(
  history: OperationHistory<JpegEditableState>,
  input: BlockTransferOperation,
): Result<ProjectDocument<JpegEditableState>> {
  const limit = checkOperationLimit(history);
  if (!limit.ok) return limit;
  if (!isBlockTransferParameters(input, history.snapshot.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The block transfer must use equal-size, in-bounds regions in one component.",
    });
  }
  return history.add(input.kind, 1, { ...input });
}

export function applyBlockShiftOperation(
  history: OperationHistory<JpegEditableState>,
  input: BlockShiftOperation,
): Result<ProjectDocument<JpegEditableState>> {
  const limit = checkOperationLimit(history);
  if (!limit.ok) return limit;
  const parameters = { ...input, mask: spatialMaskToJson(input.mask) };
  if (!isBlockShiftParameters(parameters, history.snapshot.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The block shift parameters, component, or mask are invalid.",
    });
  }
  return history.add(
    input.kind,
    1,
    {
      kind: input.kind,
      componentIndex: input.componentIndex,
      mask: spatialMaskToJson(input.mask),
      offsetX: input.offsetX,
      offsetY: input.offsetY,
    },
    { maskId: input.mask.id },
  );
}

export function applyQuantizationOperation(
  history: OperationHistory<JpegEditableState>,
  input: QuantizationOperation,
): Result<ProjectDocument<JpegEditableState>> {
  const limit = checkOperationLimit(history);
  if (!limit.ok) return limit;
  if (!isQuantizationParameters(input, history.snapshot.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The quantization edit must select an existing table and contain 64 integer values from 1 to 255.",
    });
  }
  return history.add(input.kind, 1, {
    ...input,
    values: [...input.values],
  });
}
