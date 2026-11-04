import { describe, expect, it } from "vitest";
import { createProjectDocument, OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { OperationHistory } from "../../src/operations/history";
import {
  OperationRegistry,
  parseOperationStack,
  serializeOperationStack,
  type JsonValue,
  type OperationDefinition,
} from "../../src/operations/schema";
import { readFile } from "node:fs/promises";
import { failure, success } from "../../src/shared/result";

interface NumericState {
  readonly value: number;
  readonly trace: readonly string[];
}

type TransformParameters = {
  readonly multiply: number;
  readonly add: number;
};

function isTransformParameters(value: unknown): value is TransformParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const multiply = Reflect.get(value, "multiply");
  const add = Reflect.get(value, "add");
  return (
    typeof multiply === "number" &&
    Number.isFinite(multiply) &&
    typeof add === "number" &&
    Number.isFinite(add)
  );
}

const transformOperation: OperationDefinition<
  NumericState,
  TransformParameters
> = {
  type: "test/transform",
  version: 1,
  domain: "jpeg-coefficients",
  requiresReencoding: true,
  validateParameters: isTransformParameters,
  apply: (state, parameters) =>
    success({
      value: state.value * parameters.multiply + parameters.add,
      trace: [...state.trace, `${parameters.multiply}x+${parameters.add}`],
    }),
};

async function createHistory() {
  const bytes = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-grayscale.jpg", import.meta.url),
    ),
  );
  const inspection = inspectJpeg(bytes);
  const originalAsset = OriginalAsset.create({
    fileName: "source.jpg",
    sha256: "c".repeat(64),
    bytes,
  });
  if (!inspection.ok || !originalAsset.ok) {
    throw new Error("Test fixture did not produce a JPEG project.");
  }
  const registry = new OperationRegistry<NumericState>();
  const registered = registry.register(transformOperation);
  if (!registered.ok) throw new Error(registered.error.message);
  const document = createProjectDocument(
    originalAsset.value,
    inspection.value,
    {
      value: 1,
      trace: [],
    },
  );
  return {
    history: new OperationHistory(document, registry),
    registry,
    sourceBytes: bytes.slice(),
  };
}

describe("operation history", () => {
  it("replays ordered operations from the immutable base state", async () => {
    const { history, sourceBytes } = await createHistory();
    const first = history.add("test/transform", 1, {
      multiply: 2,
      add: 0,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = history.add("test/transform", 1, {
      multiply: 1,
      add: 3,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.currentState).toEqual({
      value: 5,
      trace: ["2x+0", "1x+3"],
    });
    expect(second.value.operations.map(({ status }) => status)).toEqual([
      "applied",
      "applied",
    ]);

    const reordered = history.move(second.value.operations[0]!.id, 1);
    expect(reordered).toMatchObject({
      ok: true,
      value: {
        currentState: { value: 8, trace: ["1x+3", "2x+0"] },
      },
    });
    expect(Buffer.from(history.snapshot.originalAsset.readBytes())).toEqual(
      Buffer.from(sourceBytes),
    );
  });

  it("undoes and redoes exact editable snapshots and clears redo after a new edit", async () => {
    const { history } = await createHistory();
    const one = history.add("test/transform", 1, {
      multiply: 2,
      add: 0,
    });
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const priorState = one.value.currentState;
    const two = history.add("test/transform", 1, {
      multiply: 1,
      add: 3,
    });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    const finalState = two.value.currentState;

    expect(history.undo()).toMatchObject({
      ok: true,
      value: { currentState: priorState, operations: [{ status: "applied" }] },
    });
    expect(history.redo()).toMatchObject({
      ok: true,
      value: { currentState: finalState },
    });
    expect(history.undo().ok).toBe(true);
    const branch = history.add("test/transform", 1, {
      multiply: 1,
      add: 7,
    });
    expect(branch).toMatchObject({
      ok: true,
      value: { currentState: { value: 9 } },
    });
    expect(history.canRedo).toBe(false);
  });

  it("supports enable, delete, parameter editing, and reset through replay", async () => {
    const { history } = await createHistory();
    const first = history.add("test/transform", 1, {
      multiply: 2,
      add: 0,
    });
    if (!first.ok) throw new Error(first.error.message);
    const second = history.add("test/transform", 1, {
      multiply: 1,
      add: 3,
    });
    if (!second.ok) throw new Error(second.error.message);
    const firstId = second.value.operations[0]!.id;
    const secondId = second.value.operations[1]!.id;

    expect(history.setEnabled(firstId, false)).toMatchObject({
      ok: true,
      value: { currentState: { value: 4 } },
    });
    expect(
      history.editParameters(secondId, { multiply: 1, add: 7 }),
    ).toMatchObject({ ok: true, value: { currentState: { value: 8 } } });
    expect(history.delete(firstId)).toMatchObject({
      ok: true,
      value: { currentState: { value: 8 }, operations: [{ id: secondId }] },
    });
    expect(history.resetToOriginal()).toMatchObject({
      ok: true,
      value: { currentState: { value: 1 }, operations: [] },
    });
  });

  it("rejects invalid parameters and unknown versions without changing the document", async () => {
    const { history } = await createHistory();
    const before = history.snapshot;

    expect(history.add("test/transform", 1, { multiply: "bad" })).toMatchObject(
      {
        ok: false,
        error: { code: "INVALID_INPUT" },
      },
    );
    expect(
      history.add("test/transform", 2, { multiply: 1, add: 0 }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });
    expect(history.snapshot).toBe(before);
  });

  it("copies and freezes operation parameters", async () => {
    const { history } = await createHistory();
    const parameters = { multiply: 2, add: 1 };
    const added = history.add("test/transform", 1, parameters);
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    parameters.add = 99;
    expect(added.value.operations[0]?.parameters).toEqual({
      multiply: 2,
      add: 1,
    });
    expect(Object.isFrozen(added.value.operations[0]?.parameters)).toBe(true);
  });

  it("serializes and validates a versioned operation stack", async () => {
    const { history, registry } = await createHistory();
    const operation = history.add(
      "test/transform",
      1,
      { multiply: 2, add: 4 },
      { seed: 7 },
    );
    if (!operation.ok) throw new Error(operation.error.message);

    const serialized = serializeOperationStack(operation.value.operations);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(parseOperationStack(serialized.value, registry)).toMatchObject({
      ok: true,
      value: [
        {
          type: "test/transform",
          version: 1,
          parameters: { multiply: 2, add: 4 },
          seed: 7,
        },
      ],
    });
    expect(
      parseOperationStack(
        JSON.stringify({ schemaVersion: 2, operations: [] }),
        registry,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });
    expect(
      parseOperationStack(
        JSON.stringify({
          schemaVersion: 1,
          operations: [
            operation.value.operations[0],
            operation.value.operations[0],
          ],
        }),
        registry,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("replays seeded random operations deterministically", async () => {
    const randomOperation: OperationDefinition<NumericState, JsonValue> = {
      type: "test/random",
      version: 1,
      domain: "jpeg-coefficients",
      requiresReencoding: true,
      validateParameters: (value): value is JsonValue => value === null,
      apply: (state, _parameters, context) =>
        success({
          value: state.value + context.random(),
          trace: [...state.trace, "seeded random"],
        }),
    };
    const first = await createHistory();
    const second = await createHistory();
    expect(first.registry.register(randomOperation).ok).toBe(true);
    expect(second.registry.register(randomOperation).ok).toBe(true);

    const firstResult = first.history.add("test/random", 1, null, {
      seed: 1234,
    });
    const secondResult = second.history.add("test/random", 1, null, {
      seed: 1234,
    });
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;
    expect(firstResult.value.currentState).toEqual(
      secondResult.value.currentState,
    );

    const operationId = firstResult.value.operations[0]!.id;
    first.history.setEnabled(operationId, false);
    expect(first.history.setEnabled(operationId, true)).toMatchObject({
      ok: true,
      value: { currentState: firstResult.value.currentState },
    });
  });

  it("keeps the document unchanged when an operation execution fails", async () => {
    const { history } = await createHistory();
    const failing: OperationDefinition<NumericState, JsonValue> = {
      type: "test/failure",
      version: 1,
      domain: "jpeg-coefficients",
      requiresReencoding: true,
      validateParameters: (value): value is JsonValue => value === null,
      apply: () =>
        failure({
          code: "PROCESSING_FAILED",
          message: "Synthetic operation failure.",
        }),
    };
    const registered = new OperationRegistry<NumericState>();
    const addTransform = registered.register(transformOperation);
    const addFailure = registered.register(failing);
    expect(addTransform.ok && addFailure.ok).toBe(true);
    if (!addTransform.ok || !addFailure.ok) return;
    const original = history.snapshot;
    const otherHistory = new OperationHistory(original, registered);

    expect(otherHistory.add("test/failure", 1, null)).toMatchObject({
      ok: false,
      error: { code: "PROCESSING_FAILED" },
    });
    expect(otherHistory.snapshot.operations).toEqual([]);
    expect(otherHistory.snapshot.currentState).toEqual(original.currentState);
  });
});
