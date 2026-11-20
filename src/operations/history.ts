import { failure, success, type Result } from "../shared/result";
import {
  createOperationRandom,
  parseOperationRecord,
  cloneAndFreezeJson,
  isJsonValue,
  OperationRegistry,
  type JsonValue,
  type OperationContext,
  type OperationRecord,
} from "./schema";
import type { ProjectDocument } from "../document/model";

interface DocumentFrame<State> {
  readonly currentState: State;
  readonly operations: readonly OperationRecord[];
}

export class OperationHistory<State> {
  private readonly baseState: State;
  private readonly registry: OperationRegistry<State> | undefined;
  private readonly past: DocumentFrame<State>[] = [];
  private readonly future: DocumentFrame<State>[] = [];
  private document: ProjectDocument<State>;
  private revision: number;
  private readonly plan?: (
    operations: readonly OperationRecord[],
  ) => Result<State>;

  constructor(
    document: ProjectDocument<State>,
    registry: OperationRegistry<State> | undefined,
    plan?: (operations: readonly OperationRecord[]) => Result<State>,
  ) {
    this.plan = plan;
    this.baseState = document.currentState;
    this.registry = registry;
    this.document = document;
    this.revision = document.revision;
  }

  get snapshot(): ProjectDocument<State> {
    return this.document;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  restoreOperations(
    operations: readonly OperationRecord[],
  ): Result<ProjectDocument<State>> {
    if (!Array.isArray(operations) || operations.length > 10_000) {
      return failure({
        code: "INVALID_INPUT",
        message: "The saved operation stack exceeds the supported size.",
      });
    }

    const seenIds = new Set<string>();
    const validated: OperationRecord[] = [];
    for (const operation of operations) {
      const parsed = parseOperationRecord(operation, this.registry);
      if (!parsed.ok) return parsed;
      if (seenIds.has(parsed.value.id)) {
        return failure({
          code: "INVALID_INPUT",
          message: "The saved operation stack contains duplicate IDs.",
        });
      }
      seenIds.add(parsed.value.id);
      validated.push(parsed.value);
    }

    const restored = this.replay(
      validated.map((operation) =>
        Object.freeze({
          ...operation,
          parameters: cloneAndFreezeJson(operation.parameters),
        }),
      ),
    );
    if (!restored.ok) return restored;
    this.past.length = 0;
    this.future.length = 0;
    return restored;
  }

  add(
    type: string,
    version: number,
    parameters: JsonValue,
    options: { seed?: number; maskId?: string } = {},
  ): Result<ProjectDocument<State>> {
    if (!isJsonValue(parameters)) {
      return failure({
        code: "INVALID_INPUT",
        message: "Operation parameters must be finite JSON data.",
      });
    }
    if (this.registry) {
      const definition = this.registry.resolve(type, version);
      if (!definition.ok) return definition;
      if (!definition.value.validateParameters(parameters)) {
        return failure({
          code: "INVALID_INPUT",
          message: `Parameters for operation ${type} are invalid.`,
        });
      }
    }
    if (
      options.seed !== undefined &&
      (!Number.isInteger(options.seed) ||
        options.seed < 0 ||
        options.seed > 0xffff_ffff)
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "A random seed must be an unsigned 32-bit integer.",
      });
    }
    if (options.maskId !== undefined && options.maskId.trim().length === 0) {
      return failure({
        code: "INVALID_INPUT",
        message: "The operation mask reference is invalid.",
      });
    }

    const operation: OperationRecord = Object.freeze({
      id: crypto.randomUUID(),
      type,
      version,
      parameters: cloneAndFreezeJson(parameters),
      enabled: true,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.maskId === undefined ? {} : { maskId: options.maskId }),
      inputRevision: this.document.revision,
      status: this.plan ? "applied" : "queued",
    });
    return this.replay([...this.document.operations, operation]);
  }

  setEnabled(id: string, enabled: boolean): Result<ProjectDocument<State>> {
    const index = this.document.operations.findIndex(
      (operation) => operation.id === id,
    );
    if (index < 0) return this.missingOperation();
    if (this.document.operations[index]!.enabled === enabled) {
      return success(this.document);
    }
    const operations = this.document.operations.map((operation) =>
      operation.id === id
        ? Object.freeze({ ...operation, enabled })
        : operation,
    );
    return this.replay(operations);
  }

  delete(id: string): Result<ProjectDocument<State>> {
    const operations = this.document.operations.filter(
      (operation) => operation.id !== id,
    );
    if (operations.length === this.document.operations.length) {
      return this.missingOperation();
    }
    return this.replay(operations);
  }

  move(id: string, targetIndex: number): Result<ProjectDocument<State>> {
    const sourceIndex = this.document.operations.findIndex(
      (operation) => operation.id === id,
    );
    if (
      sourceIndex < 0 ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= this.document.operations.length
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "The operation or destination position is invalid.",
      });
    }
    if (sourceIndex === targetIndex) return success(this.document);

    const operations = [...this.document.operations];
    const [operation] = operations.splice(sourceIndex, 1);
    if (!operation) return this.missingOperation();
    operations.splice(targetIndex, 0, operation);
    return this.replay(operations);
  }

  resetToOriginal(): Result<ProjectDocument<State>> {
    if (this.document.operations.length === 0) return success(this.document);
    return this.replay([]);
  }

  undo(): Result<ProjectDocument<State>> {
    const frame = this.past.pop();
    if (!frame) {
      return failure({
        code: "INVALID_INPUT",
        message: "There is no operation history to undo.",
      });
    }
    this.future.push(this.capture());
    this.revision += 1;
    this.document = Object.freeze({
      ...this.document,
      revision: this.revision,
      currentState: frame.currentState,
      operations: frame.operations,
    });
    return success(this.document);
  }

  redo(): Result<ProjectDocument<State>> {
    const frame = this.future.pop();
    if (!frame) {
      return failure({
        code: "INVALID_INPUT",
        message: "There is no operation history to redo.",
      });
    }
    this.past.push(this.capture());
    this.revision += 1;
    this.document = Object.freeze({
      ...this.document,
      revision: this.revision,
      currentState: frame.currentState,
      operations: frame.operations,
    });
    return success(this.document);
  }

  private replay(
    operations: readonly OperationRecord[],
  ): Result<ProjectDocument<State>> {
    if (this.plan) {
      const planned = this.plan(operations);
      if (!planned.ok) return planned;
      this.past.push(this.capture());
      this.future.length = 0;
      this.revision += 1;
      this.document = Object.freeze({
        ...this.document,
        revision: this.revision,
        currentState: planned.value,
        operations: Object.freeze([...operations]),
      });
      return success(this.document);
    }
    const registry = this.registry;
    if (!registry)
      return failure({
        code: "INTERNAL",
        message: "The operation planner is unavailable.",
      });
    let state = this.baseState;
    const replayed: OperationRecord[] = [];

    for (const operation of operations) {
      const definition = registry.resolve(operation.type, operation.version);
      if (!definition.ok) return definition;
      if (!definition.value.validateParameters(operation.parameters)) {
        return failure({
          code: "INVALID_INPUT",
          message: `Parameters for operation ${operation.type} are invalid.`,
        });
      }

      if (!operation.enabled) {
        replayed.push(
          Object.freeze({
            ...operation,
            inputRevision: this.document.revision,
            status: "queued",
          }),
        );
        continue;
      }

      const random = createOperationRandom(operation.seed);
      if (!random.ok) return random;
      const context: OperationContext = {
        ...(operation.seed === undefined ? {} : { seed: operation.seed }),
        random: random.value,
      };
      const applied = definition.value.apply(
        state,
        operation.parameters,
        context,
      );
      if (!applied.ok) return applied;
      state = applied.value;
      replayed.push(
        Object.freeze({
          ...operation,
          inputRevision: this.document.revision,
          status: "applied",
        }),
      );
    }

    this.past.push(this.capture());
    this.future.length = 0;
    this.revision += 1;
    this.document = Object.freeze({
      ...this.document,
      revision: this.revision,
      currentState: state,
      operations: Object.freeze(replayed),
    });
    return success(this.document);
  }

  private capture(): DocumentFrame<State> {
    return {
      currentState: this.document.currentState,
      operations: this.document.operations,
    };
  }

  private missingOperation(): Result<never> {
    return failure({
      code: "INVALID_INPUT",
      message: "The requested operation is not in this document.",
    });
  }
}
