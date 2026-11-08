import { createProjectDocument } from "../document/model";
import {
  isValidMaskName,
  isSpatialMask,
  namedSpatialMaskParameters,
  spatialMaskToJson,
  type NamedSpatialMask,
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
  isExperimentRecipe,
  isCoefficientRecipeStep,
  MAX_RECIPE_STEPS,
  type ExperimentRecipe,
} from "./experiment-recipes";
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
import type { ProjectDocument } from "../document/model";

export interface JpegEditableState {
  readonly masks: readonly NamedSpatialMask[];
  readonly jpegOperations: readonly JpegGlitchOperation[];
}

type ApplyMaskParameters = {
  readonly name: string;
  readonly mask: JsonValue;
};

type ApplyCoefficientRecipeParameters = {
  readonly kind: "coefficient-recipe";
  readonly name: string;
  readonly componentIndex: number;
  readonly mask: JsonValue;
  readonly steps: readonly JsonValue[];
};

function isApplyMaskParameters(value: unknown): value is ApplyMaskParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    isValidMaskName(Reflect.get(value, "name")) &&
    isSpatialMask(Reflect.get(value, "mask"))
  );
}

function isApplyCoefficientRecipeParameters(
  value: unknown,
  inspection: ImportedJpeg["inspection"],
): value is ApplyCoefficientRecipeParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const mask = Reflect.get(value, "mask");
  const componentIndex = Reflect.get(value, "componentIndex");
  const name = Reflect.get(value, "name");
  const steps = Reflect.get(value, "steps");
  return (
    Reflect.get(value, "kind") === "coefficient-recipe" &&
    isSpatialMask(mask) &&
    mask.width === inspection.width &&
    mask.height === inspection.height &&
    isValidMaskName(name) &&
    typeof componentIndex === "number" &&
    Number.isInteger(componentIndex) &&
    componentIndex >= 0 &&
    componentIndex < inspection.components.length &&
    Array.isArray(steps) &&
    steps.length > 0 &&
    steps.length <= MAX_RECIPE_STEPS &&
    steps.every((step) => {
      if (!isCoefficientRecipeStep(step)) return false;
      return isCoefficientGlitchParameters(
        {
          kind: "coefficients",
          mask,
          componentIndex,
          ...step,
        },
        inspection,
      );
    })
  );
}

function appendOperation(
  state: Readonly<JpegEditableState>,
  operation: JpegGlitchOperation,
): JpegEditableState {
  return Object.freeze({
    ...state,
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
      const name = parameters.name.trim();
      if (
        state.masks.some(
          (saved) =>
            saved.mask.id === mask.id ||
            saved.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return failure({
          code: "INVALID_INPUT",
          message: "A saved mask already uses this name or mask identity.",
        });
      }
      return success(
        Object.freeze({
          ...state,
          masks: Object.freeze([...state.masks, Object.freeze({ name, mask })]),
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
      "jpeg/glitch/block-shift",
      "jpeg-coefficients",
      (value) => isBlockShiftParameters(value, imported.inspection),
      (parameters) =>
        isBlockShiftParameters(parameters, imported.inspection)
          ? success(parameters)
          : failure({
              code: "INVALID_INPUT",
              message: "The block shift parameters are invalid.",
            }),
    ),
    registerGlitchOperation(
      registry,
      "jpeg/glitch/block-transfer",
      "jpeg-coefficients",
      (value) => isBlockTransferParameters(value, imported.inspection),
      (parameters) =>
        isBlockTransferParameters(parameters, imported.inspection)
          ? success(parameters)
          : failure({
              code: "INVALID_INPUT",
              message: "The block transfer parameters are invalid.",
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

  const recipeRegistration =
    registry.register<ApplyCoefficientRecipeParameters>({
      type: "jpeg/glitch/coefficient-recipe",
      version: 1,
      domain: "jpeg-coefficients",
      requiresReencoding: true,
      validateParameters: (value): value is ApplyCoefficientRecipeParameters =>
        isApplyCoefficientRecipeParameters(value, imported.inspection),
      apply: (state, parameters) => {
        if (
          !isApplyCoefficientRecipeParameters(parameters, imported.inspection)
        ) {
          return failure({
            code: "INVALID_INPUT",
            message: "The coefficient experiment recipe is invalid.",
          });
        }
        if (
          state.jpegOperations.length + parameters.steps.length >
          MAX_GLITCH_OPERATIONS
        ) {
          return failure({
            code: "INVALID_INPUT",
            message: `A document supports at most ${MAX_GLITCH_OPERATIONS} JPEG glitch operations.`,
          });
        }
        const mask = parameters.mask;
        if (!isSpatialMask(mask)) {
          return failure({
            code: "INVALID_INPUT",
            message: "The coefficient experiment recipe mask is invalid.",
          });
        }
        const recipeOperations: JpegGlitchOperation[] = [];
        for (const step of parameters.steps) {
          if (!isCoefficientRecipeStep(step)) {
            return failure({
              code: "INVALID_INPUT",
              message: "A coefficient experiment recipe step is invalid.",
            });
          }
          recipeOperations.push({
            kind: "coefficients",
            mask,
            componentIndex: parameters.componentIndex,
            domain: step.domain,
            mode: step.mode,
            frequencyBand: step.frequencyBand,
            strength: step.strength,
            seed: step.seed,
          });
        }
        return success(
          Object.freeze({
            ...state,
            jpegOperations: Object.freeze([
              ...state.jpegOperations,
              ...recipeOperations,
            ]),
          }),
        );
      },
    });
  if (!recipeRegistration.ok) return recipeRegistration;

  const projectDocument = createProjectDocument(
    imported.originalAsset,
    imported.inspection,
    Object.freeze({
      masks: Object.freeze([]),
      jpegOperations: Object.freeze([]),
    }),
  );
  return success(new OperationHistory(projectDocument, registry));
}

export function applyMaskToDocument(
  history: OperationHistory<JpegEditableState>,
  mask: SpatialMask,
  name: string,
): Result<ProjectDocument<JpegEditableState>> {
  if (!isSpatialMask(mask) || !isValidMaskName(name)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The saved mask name or spatial mask is invalid.",
    });
  }
  return history.add(
    "spatial/apply-mask",
    1,
    namedSpatialMaskParameters(name, mask),
  );
}

export function applyCoefficientRecipeOperation(
  history: OperationHistory<JpegEditableState>,
  input: {
    readonly recipe: ExperimentRecipe;
    readonly mask: SpatialMask;
    readonly componentIndex: number;
  },
): Result<ProjectDocument<JpegEditableState>> {
  if (
    !isExperimentRecipe(input.recipe) ||
    !isSpatialMask(input.mask) ||
    input.mask.width !== history.snapshot.inspection.width ||
    input.mask.height !== history.snapshot.inspection.height ||
    !Number.isInteger(input.componentIndex) ||
    input.componentIndex < 0 ||
    input.componentIndex >= history.snapshot.inspection.components.length
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The recipe, mask, or target component is invalid.",
    });
  }
  if (
    history.snapshot.currentState.jpegOperations.length +
      input.recipe.steps.length >
    MAX_GLITCH_OPERATIONS
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: `A document supports at most ${MAX_GLITCH_OPERATIONS} JPEG glitch operations.`,
    });
  }

  const parameters = {
    kind: "coefficient-recipe" as const,
    name: input.recipe.name,
    componentIndex: input.componentIndex,
    mask: spatialMaskToJson(input.mask),
    steps: input.recipe.steps.map((step) => ({ ...step })),
  };
  if (
    !isApplyCoefficientRecipeParameters(parameters, history.snapshot.inspection)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The coefficient experiment recipe is incompatible with the selected JPEG.",
    });
  }
  return history.add("jpeg/glitch/coefficient-recipe", 1, parameters, {
    maskId: input.mask.id,
  });
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
  return history.add("jpeg/glitch/block-transfer", 1, { ...input });
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
    "jpeg/glitch/block-shift",
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
  return history.add("jpeg/glitch/quantization", 1, {
    ...input,
    values: [...input.values],
  });
}
