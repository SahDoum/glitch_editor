import { createProjectDocument } from "../document/model";
import {
  isSpatialMask,
  spatialMaskParameters,
  spatialMaskToJson,
  type SpatialMask,
} from "../document/masks";
import type { ImportedJpeg } from "./import-jpeg";
import { OperationHistory } from "../operations/history";
import {
  OperationRegistry,
  type JsonValue,
  type OperationDefinition,
} from "../operations/schema";
import { failure, success, type Result } from "../shared/result";
import {
  isBlockRepeatParameters,
  isBlockPermutationParameters,
  isCoefficientGlitchParameters,
  isQuantizationParameters,
  MAX_GLITCH_OPERATIONS,
  type BlockRepeatOperation,
  type BlockPermutationOperation,
  type CoefficientGlitchOperation,
  type JpegGlitchOperation,
  type QuantizationOperation,
} from "../operations/jpeg-glitch";
import type { ProjectDocument } from "../document/model";

export interface JpegEditableState {
  readonly activeMask: SpatialMask | null;
  readonly masks: readonly SpatialMask[];
  readonly jpegOperations: readonly JpegGlitchOperation[];
}

type ApplyMaskParameters = { readonly mask: JsonValue };

function isApplyMaskParameters(value: unknown): value is ApplyMaskParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return isSpatialMask(Reflect.get(value, "mask"));
}

function appendOperation(
  state: Readonly<JpegEditableState>,
  operation: JpegGlitchOperation,
): JpegEditableState {
  const mask =
    operation.kind === "coefficients" || operation.kind === "block-permutation"
      ? operation.mask
      : null;
  return Object.freeze({
    ...state,
    ...(mask
      ? {
          activeMask: mask,
          masks: Object.freeze([
            ...state.masks.filter((candidate) => candidate.id !== mask.id),
            mask,
          ]),
        }
      : {}),
    jpegOperations: Object.freeze([...state.jpegOperations, operation]),
  });
}

function registerGlitchOperation(
  registry: OperationRegistry<JpegEditableState>,
  type: string,
  domain: OperationDefinition<JpegEditableState, JsonValue>["domain"],
  validate: (value: unknown) => boolean,
  convert: (parameters: JsonValue) => Result<JpegGlitchOperation>,
): Result<undefined> {
  const definition: OperationDefinition<JpegEditableState, JsonValue> = {
    type,
    version: 1,
    domain,
    requiresReencoding: true,
    validateParameters: (value): value is JsonValue => validate(value),
    apply: (state, parameters) => {
      if (!validate(parameters)) {
        return failure({
          code: "INVALID_INPUT",
          message: `The ${type} operation parameters are invalid.`,
        });
      }
      const operation = convert(parameters);
      if (!operation.ok) return operation;
      return success(appendOperation(state, operation.value));
    },
  };
  return registry.register(definition);
}

export function createJpegDocumentSession(
  imported: ImportedJpeg,
): Result<OperationHistory<JpegEditableState>> {
  const registry = new OperationRegistry<JpegEditableState>();
  const registered = registry.register<ApplyMaskParameters>({
    type: "spatial/apply-mask",
    version: 1,
    domain: "spatial-mask",
    requiresReencoding: false,
    validateParameters: isApplyMaskParameters,
    apply: (state, parameters) => {
      if (!isSpatialMask(parameters.mask)) {
        return failure({
          code: "INVALID_INPUT",
          message: "The spatial mask operation parameters are invalid.",
        });
      }
      const mask = parameters.mask;
      return success(
        Object.freeze({
          ...state,
          activeMask: mask,
          masks: Object.freeze([
            ...state.masks.filter((candidate) => candidate.id !== mask.id),
            mask,
          ]),
        }),
      );
    },
  });
  if (!registered.ok) return registered;

  const operations: Result<undefined>[] = [
    registerGlitchOperation(
      registry,
      "jpeg/glitch/coefficients",
      "jpeg-coefficients",
      (value) => isCoefficientGlitchParameters(value, imported.inspection),
      (parameters) =>
        isCoefficientGlitchParameters(parameters, imported.inspection)
          ? success(parameters)
          : failure({
              code: "INVALID_INPUT",
              message: "The coefficient glitch parameters are invalid.",
            }),
    ),
    registerGlitchOperation(
      registry,
      "jpeg/glitch/block-repeat",
      "jpeg-coefficients",
      (value) => isBlockRepeatParameters(value, imported.inspection),
      (parameters) =>
        isBlockRepeatParameters(parameters, imported.inspection)
          ? success(parameters)
          : failure({
              code: "INVALID_INPUT",
              message: "The block repeat parameters are invalid.",
            }),
    ),
    registerGlitchOperation(
      registry,
      "jpeg/glitch/block-permutation",
      "jpeg-coefficients",
      (value) => isBlockPermutationParameters(value, imported.inspection),
      (parameters) =>
        isBlockPermutationParameters(parameters, imported.inspection)
          ? success(parameters)
          : failure({
              code: "INVALID_INPUT",
              message: "The block permutation parameters are invalid.",
            }),
    ),
    registerGlitchOperation(
      registry,
      "jpeg/glitch/quantization",
      "jpeg-structure",
      (value) => isQuantizationParameters(value, imported.inspection),
      (parameters) =>
        isQuantizationParameters(parameters, imported.inspection)
          ? success(parameters)
          : failure({
              code: "INVALID_INPUT",
              message: "The quantization parameters are invalid.",
            }),
    ),
  ];
  for (const result of operations) {
    if (!result.ok) return result;
  }

  const projectDocument = createProjectDocument(
    imported.originalAsset,
    imported.inspection,
    Object.freeze({
      activeMask: null,
      masks: Object.freeze([]),
      jpegOperations: Object.freeze([]),
    }),
  );
  return success(new OperationHistory(projectDocument, registry));
}

export function applyMaskToDocument(
  history: OperationHistory<JpegEditableState>,
  mask: SpatialMask,
): Result<ProjectDocument<JpegEditableState>> {
  if (!isSpatialMask(mask)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The spatial mask is invalid.",
    });
  }
  return history.add("spatial/apply-mask", 1, spatialMaskParameters(mask));
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
    "jpeg/glitch/coefficients",
    1,
    {
      kind: input.kind,
      mask: spatialMaskToJson(input.mask),
      componentIndex: input.componentIndex,
      domain: input.domain,
      mode: input.mode,
      frequencyBand: input.frequencyBand,
      strength: input.strength,
      seed: input.seed,
    },
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
  return history.add("jpeg/glitch/block-repeat", 1, {
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
    "jpeg/glitch/block-permutation",
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
  return history.add("jpeg/glitch/quantization", 1, {
    ...input,
    values: [...input.values],
  });
}
