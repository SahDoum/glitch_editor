import { createProjectDocument } from "../document/model";
import { spatialMaskParameters } from "../document/masks";
import type { ImportedJpeg } from "./import-jpeg";
import { OperationHistory } from "../operations/history";
import {
  OperationRegistry,
  type JsonValue,
  type OperationDefinition,
} from "../operations/schema";
import { failure, success, type Result } from "../shared/result";
import { isSpatialMask, type SpatialMask } from "../document/masks";
import type { ProjectDocument } from "../document/model";

export interface JpegEditableState {
  readonly activeMask: SpatialMask | null;
  readonly masks: readonly SpatialMask[];
}

type ApplyMaskParameters = { readonly mask: JsonValue };

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
        activeMask: mask,
        masks: Object.freeze(masks),
      }),
    );
  },
};

export function createJpegDocumentSession(
  imported: ImportedJpeg,
): Result<OperationHistory<JpegEditableState>> {
  const registry = new OperationRegistry<JpegEditableState>();
  const registered = registry.register(applyMaskOperation);
  if (!registered.ok) return registered;

  const projectDocument = createProjectDocument(
    imported.originalAsset,
    imported.inspection,
    Object.freeze({ activeMask: null, masks: Object.freeze([]) }),
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
