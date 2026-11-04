import { failure, success, type Result } from "../shared/result";
import { createSeededRandom, type SeededRandom } from "../shared/random";
import type { SpatialMask } from "../document/masks";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type OperationStatus = "queued" | "previewing" | "applied" | "failed";

export interface OperationRecord {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly parameters: JsonValue;
  readonly enabled: boolean;
  readonly maskId?: string;
  readonly targetComponents?: readonly number[];
  readonly seed?: number;
  readonly inputRevision: number;
  readonly status: OperationStatus;
  readonly diagnostics?: readonly string[];
}

export interface OperationContext {
  readonly seed?: number;
  readonly random: SeededRandom;
  readonly mask?: SpatialMask;
}

export interface OperationDefinition<State, Parameters extends JsonValue> {
  readonly type: string;
  readonly version: number;
  readonly domain:
    | "spatial-mask"
    | "jpeg-coefficients"
    | "jpeg-structure"
    | "entropy-stream"
    | "raw-bytes";
  readonly requiresReencoding: boolean;
  validateParameters(value: unknown): value is Parameters;
  apply(
    state: Readonly<State>,
    parameters: Parameters,
    context: OperationContext,
  ): Result<State>;
}

export interface RegisteredOperation<State> {
  readonly type: string;
  readonly version: number;
  readonly domain: OperationDefinition<State, JsonValue>["domain"];
  readonly requiresReencoding: boolean;
  validateParameters(value: unknown): boolean;
  apply(
    state: Readonly<State>,
    parameters: unknown,
    context: OperationContext,
  ): Result<State>;
}

export function isJsonValue(
  value: unknown,
  depth = 0,
  ancestors: ReadonlySet<object> = new Set(),
): value is JsonValue {
  if (depth > 64) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1, nextAncestors));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((item) =>
    isJsonValue(item, depth + 1, nextAncestors),
  );
}

export function cloneAndFreezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeJson));
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      copy[key] = cloneAndFreezeJson(child);
    }
    return Object.freeze(copy);
  }
  return value;
}

export class OperationRegistry<State> {
  private readonly definitions = new Map<string, RegisteredOperation<State>>();

  register<Parameters extends JsonValue>(
    definition: OperationDefinition<State, Parameters>,
  ): Result<undefined> {
    if (
      definition.type.trim().length === 0 ||
      !Number.isSafeInteger(definition.version) ||
      definition.version < 1
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "The operation type or version is invalid.",
      });
    }

    const key = this.key(definition.type, definition.version);
    if (this.definitions.has(key)) {
      return failure({
        code: "INVALID_INPUT",
        message: `Operation ${definition.type} version ${definition.version} is already registered.`,
      });
    }

    this.definitions.set(key, {
      type: definition.type,
      version: definition.version,
      domain: definition.domain,
      requiresReencoding: definition.requiresReencoding,
      validateParameters: (value) => definition.validateParameters(value),
      apply: (state, parameters, context) => {
        if (!definition.validateParameters(parameters)) {
          return failure({
            code: "INVALID_INPUT",
            message: `Parameters for operation ${definition.type} are invalid.`,
          });
        }
        return definition.apply(state, parameters, context);
      },
    });
    return success(undefined);
  }

  resolve(type: string, version: number): Result<RegisteredOperation<State>> {
    const definition = this.definitions.get(this.key(type, version));
    if (!definition) {
      return failure({
        code: "UNSUPPORTED_FORMAT",
        message: `Operation ${type} version ${version} is not registered.`,
      });
    }
    return success(definition);
  }

  validateParameters(
    type: string,
    version: number,
    parameters: unknown,
  ): boolean {
    const definition = this.definitions.get(this.key(type, version));
    return definition?.validateParameters(parameters) ?? false;
  }

  private key(type: string, version: number): string {
    return `${type}@${version}`;
  }
}

export const OPERATION_STACK_SCHEMA_VERSION = 1;
const MAX_OPERATION_COUNT = 10_000;

export function serializeOperationStack(
  operations: readonly OperationRecord[],
): Result<string> {
  if (operations.length > MAX_OPERATION_COUNT) {
    return failure({
      code: "INVALID_INPUT",
      message: "The operation stack exceeds the supported size.",
    });
  }
  if (
    !operations.every(
      (operation) =>
        isJsonValue(operation.parameters) &&
        Number.isSafeInteger(operation.version) &&
        operation.version > 0 &&
        Number.isSafeInteger(operation.inputRevision) &&
        operation.inputRevision >= 0,
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The operation stack contains data that cannot be serialized.",
    });
  }

  try {
    return success(
      JSON.stringify({
        schemaVersion: OPERATION_STACK_SCHEMA_VERSION,
        operations,
      }),
    );
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "The operation stack could not be serialized.",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationStatus(value: unknown): value is OperationStatus {
  return (
    value === "queued" ||
    value === "previewing" ||
    value === "applied" ||
    value === "failed"
  );
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === "number" && Number.isSafeInteger(item),
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseOperationRecord<State>(
  value: unknown,
  registry: OperationRegistry<State>,
): Result<OperationRecord> {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.type !== "string" ||
    value.type.trim().length === 0 ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.enabled !== "boolean" ||
    typeof value.inputRevision !== "number" ||
    !Number.isSafeInteger(value.inputRevision) ||
    value.inputRevision < 0 ||
    !isOperationStatus(value.status) ||
    !isJsonValue(value.parameters)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The serialized operation record is invalid.",
    });
  }
  if (
    value.seed !== undefined &&
    (typeof value.seed !== "number" ||
      !Number.isInteger(value.seed) ||
      value.seed < 0 ||
      value.seed > 0xffff_ffff)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The serialized operation seed is invalid.",
    });
  }
  if (
    value.maskId !== undefined &&
    (typeof value.maskId !== "string" || value.maskId.length === 0)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The serialized operation mask reference is invalid.",
    });
  }
  if (
    value.targetComponents !== undefined &&
    (!isNumberArray(value.targetComponents) ||
      !value.targetComponents.every((component) => component >= 0))
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The serialized operation component list is invalid.",
    });
  }
  if (value.diagnostics !== undefined && !isStringArray(value.diagnostics)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The serialized operation diagnostics are invalid.",
    });
  }

  const operation: OperationRecord = {
    id: value.id,
    type: value.type,
    version: value.version,
    parameters: value.parameters,
    enabled: value.enabled,
    inputRevision: value.inputRevision,
    status: value.status,
    ...(typeof value.seed === "number" ? { seed: value.seed } : {}),
    ...(typeof value.maskId === "string" ? { maskId: value.maskId } : {}),
    ...(isNumberArray(value.targetComponents)
      ? { targetComponents: Object.freeze([...value.targetComponents]) }
      : {}),
    ...(isStringArray(value.diagnostics)
      ? { diagnostics: Object.freeze([...value.diagnostics]) }
      : {}),
  };
  const definition = registry.resolve(operation.type, operation.version);
  if (!definition.ok) return definition;
  if (!definition.value.validateParameters(operation.parameters)) {
    return failure({
      code: "INVALID_INPUT",
      message: `Parameters for operation ${operation.type} are invalid.`,
    });
  }
  return success(operation);
}

export function parseOperationStack<State>(
  serialized: string,
  registry: OperationRegistry<State>,
): Result<readonly OperationRecord[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "The serialized operation stack is not valid JSON.",
    });
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== OPERATION_STACK_SCHEMA_VERSION ||
    !Array.isArray(parsed.operations) ||
    parsed.operations.length > MAX_OPERATION_COUNT
  ) {
    return failure({
      code: "UNSUPPORTED_FORMAT",
      message: "The serialized operation stack version is not supported.",
    });
  }

  const seenIds = new Set<string>();
  const operations: OperationRecord[] = [];
  for (const value of parsed.operations) {
    const result = parseOperationRecord(value, registry);
    if (!result.ok) return result;
    if (seenIds.has(result.value.id)) {
      return failure({
        code: "INVALID_INPUT",
        message: "The serialized operation stack contains duplicate IDs.",
      });
    }
    seenIds.add(result.value.id);
    operations.push(
      Object.freeze({
        ...result.value,
        parameters: cloneAndFreezeJson(result.value.parameters),
      }),
    );
  }
  return success(Object.freeze(operations));
}

export function createOperationRandom(
  seed: number | undefined,
): Result<SeededRandom> {
  if (seed === undefined) return success(Math.random);
  return createSeededRandom(seed);
}
