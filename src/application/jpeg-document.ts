import { createProjectDocument } from "../document/model";
import { spatialMaskParameters, spatialMaskToJson } from "../document/masks";
import type { ImportedJpeg } from "./import-jpeg";
import { OperationHistory } from "../operations/history";
import {
  OperationRegistry,
  type JsonValue,
  type OperationDefinition,
} from "../operations/schema";
import { failure, success, type Result } from "../shared/result";
import {
  DCT_FREQUENCY_BANDS,
  MAX_DCT_OPERATIONS,
  type DctFrequencyBand,
} from "../operations/dct";
import { isSpatialMask, type SpatialMask } from "../document/masks";
import type { ProjectDocument } from "../document/model";

export interface JpegEditableState {
  readonly activeMask: SpatialMask | null;
  readonly masks: readonly SpatialMask[];
  readonly dctOperations: readonly DctOperation[];
}

export interface DctOperation {
  readonly mask: SpatialMask;
  readonly componentIndex: number;
  readonly frequencyBand: DctFrequencyBand;
}

type ApplyMaskParameters = { readonly mask: JsonValue };
type ZeroBandParameters = {
  readonly mask: JsonValue;
  readonly componentIndex: number;
  readonly frequencyBand: DctFrequencyBand;
};

function isApplyMaskParameters(value: unknown): value is ApplyMaskParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return isSpatialMask(Reflect.get(value, "mask"));
}

const applyMaskOperation: OperationDefinition<
  JpegEditableState,
  ApplyMaskParameters
> = {
  type: "spatial/apply-mask",
  version: 1,
  domain: "spatial-mask",
  requiresReencoding: false,
  validateParameters: isApplyMaskParameters,
  apply: (_state, parameters) => {
    if (!isSpatialMask(parameters.mask)) {
      return failure({
        code: "INVALID_INPUT",
        message: "The spatial mask operation parameters are invalid.",
      });
    }
    const mask = parameters.mask;
    const masks = [
      ..._state.masks.filter((candidate) => candidate.id !== mask.id),
      mask,
    ];
    return success(
      Object.freeze({
        ..._state,
        activeMask: mask,
        masks: Object.freeze(masks),
      }),
    );
  },
};

function isZeroBandParameters(
  value: unknown,
  inspection: ImportedJpeg["inspection"],
): value is ZeroBandParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const mask = Reflect.get(value, "mask");
  const componentIndex = Reflect.get(value, "componentIndex");
  const frequencyBand = Reflect.get(value, "frequencyBand");
  return (
    isSpatialMask(mask) &&
    mask.width === inspection.width &&
    mask.height === inspection.height &&
    typeof componentIndex === "number" &&
    Number.isInteger(componentIndex) &&
    componentIndex >= 0 &&
    componentIndex < inspection.components.length &&
    typeof frequencyBand === "string" &&
    DCT_FREQUENCY_BANDS.some((band) => band === frequencyBand)
  );
}

export function createJpegDocumentSession(
  imported: ImportedJpeg,
): Result<OperationHistory<JpegEditableState>> {
  const registry = new OperationRegistry<JpegEditableState>();
  const registered = registry.register(applyMaskOperation);
  if (!registered.ok) return registered;
  const dctOperationRegistered = registry.register<ZeroBandParameters>({
    type: "jpeg/coefficients/zero-band",
    version: 1,
    domain: "jpeg-coefficients",
    requiresReencoding: true,
    validateParameters: (value): value is ZeroBandParameters =>
      isZeroBandParameters(value, imported.inspection),
    apply: (state, parameters) => {
      if (!isZeroBandParameters(parameters, imported.inspection)) {
        return failure({
          code: "INVALID_INPUT",
          message: "The DCT operation parameters are invalid.",
        });
      }
      if (!isSpatialMask(parameters.mask)) {
        return failure({
          code: "INVALID_INPUT",
          message: "The DCT operation mask is invalid.",
        });
      }
      const mask = parameters.mask;
      const dctOperation = Object.freeze({
        mask,
        componentIndex: parameters.componentIndex,
        frequencyBand: parameters.frequencyBand,
      });
      return success(
        Object.freeze({
          ...state,
          activeMask: mask,
          masks: Object.freeze([
            ...state.masks.filter((candidate) => candidate.id !== mask.id),
            mask,
          ]),
          dctOperations: Object.freeze([...state.dctOperations, dctOperation]),
        }),
      );
    },
  });
  if (!dctOperationRegistered.ok) return dctOperationRegistered;

  const projectDocument = createProjectDocument(
    imported.originalAsset,
    imported.inspection,
    Object.freeze({
      activeMask: null,
      masks: Object.freeze([]),
      dctOperations: Object.freeze([]),
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
  const parameters = spatialMaskParameters(mask);
  return history.add("spatial/apply-mask", 1, parameters);
}

export function applyDctZeroBandOperation(
  history: OperationHistory<JpegEditableState>,
  input: {
    readonly mask: SpatialMask;
    readonly componentIndex: number;
    readonly frequencyBand: DctFrequencyBand;
  },
): Result<ProjectDocument<JpegEditableState>> {
  if (
    history.snapshot.currentState.dctOperations.length >= MAX_DCT_OPERATIONS
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: `A document supports at most ${MAX_DCT_OPERATIONS} DCT operations.`,
    });
  }
  if (
    !isSpatialMask(input.mask) ||
    !Number.isInteger(input.componentIndex) ||
    input.componentIndex < 0 ||
    !DCT_FREQUENCY_BANDS.some((band) => band === input.frequencyBand)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The DCT operation parameters are invalid.",
    });
  }

  return history.add("jpeg/coefficients/zero-band", 1, {
    mask: spatialMaskToJson(input.mask),
    componentIndex: input.componentIndex,
    frequencyBand: input.frequencyBand,
  });
}
