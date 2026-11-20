import { describe, expect, it, vi } from "vitest";
import {
  EncodingPlanCache,
  EncodingPlanIdentity,
  encodingPlanKey,
} from "../../src/application/encoding-plan";
import type { JpegGlitchOperation } from "../../src/operations/jpeg-glitch";
import { success, failure } from "../../src/shared/result";

const operation: JpegGlitchOperation = {
  kind: "block-repeat",
  componentIndex: 0,
  sourceX: 0,
  sourceY: 0,
  offsetX: 1,
  offsetY: 0,
  repetitions: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("encoding plan reuse", () => {
  it("preserves active plan identity when disabled history records move", () => {
    const identity = new EncodingPlanIdentity();
    const first = identity.resolve([operation]);
    expect(identity.resolve([{ ...operation }])).toBe(first);
    expect(identity.resolve([{ ...operation, repetitions: 2 }])).not.toBe(
      first,
    );
    expect(encodingPlanKey([operation])).not.toBe(encodingPlanKey([]));
  });

  it("hands an in-flight preview to Apply without re-encoding or detaching original bytes", async () => {
    const cache = new EncodingPlanCache();
    const source = {};
    const preview = new AbortController();
    const apply = new AbortController();
    const bytes = new Uint8Array([1, 2]);
    const work = deferred<ReturnType<typeof success<Uint8Array>>>();
    const compute = vi.fn(() => work.promise);
    const first = cache.run(source, "plan", preview.signal, compute);
    preview.abort();
    const second = cache.run(source, "plan", apply.signal, compute);
    work.resolve(success(bytes));
    expect((await first).ok).toBe(false);
    expect(await second).toEqual(success(bytes));
    expect(compute).toHaveBeenCalledTimes(1);
    expect(await cache.run(source, "plan", apply.signal, compute)).toEqual(
      success(bytes),
    );
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("keys requests by full parameters, mask content, seed and output mode", async () => {
    const cache = new EncodingPlanCache();
    const source = {};
    const compute = vi.fn(async () => success(new Uint8Array([1])));
    const signal = new AbortController().signal;
    const masked = {
      kind: "coefficients",
      componentIndex: 0,
      domain: "ac",
      mode: "randomize",
      frequencyBand: "all",
      strength: 2,
      seed: 3,
      mask: {
        schemaVersion: 1,
        id: "same",
        width: 8,
        height: 8,
        shapes: [
          { kind: "rectangle", mode: "add", x: 0, y: 0, width: 8, height: 8 },
        ],
      },
    } as const;
    const keys = [
      JSON.stringify(masked),
      JSON.stringify({ ...masked, seed: 4 }),
      JSON.stringify({ ...masked, strength: 3 }),
      JSON.stringify({ ...masked, mask: { ...masked.mask, width: 16 } }),
      JSON.stringify({ mode: "progressive", operations: masked }),
    ];
    for (const key of keys) await cache.run(source, key, signal, compute);
    expect(compute).toHaveBeenCalledTimes(5);
  });

  it("bounds retained results to two plans and isolates reopened document sessions", async () => {
    const cache = new EncodingPlanCache();
    const source = {};
    const signal = new AbortController().signal;
    const compute = vi.fn(async () => success(new Uint8Array([1])));
    for (const key of ["current", "draft", "new draft", "current"])
      await cache.run(source, key, signal, compute);
    expect(compute).toHaveBeenCalledTimes(4);
    await cache.run({}, "current", signal, compute);
    expect(compute).toHaveBeenCalledTimes(5);
  });

  it("keeps the committed bytes when replacing successive draft results", async () => {
    const cache = new EncodingPlanCache();
    const source = {};
    const signal = new AbortController().signal;
    const compute = vi.fn(async () => success(new Uint8Array([1])));
    cache.keepCommitted(source, "committed");
    for (const key of ["committed", "draft 1", "draft 2", "committed"])
      await cache.run(source, key, signal, compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("cancels abandoned computation and permits a retry after failures", async () => {
    const cache = new EncodingPlanCache();
    const source = {};
    const controller = new AbortController();
    let computingSignal: AbortSignal | undefined;
    const compute = vi.fn(async (signal: AbortSignal) => {
      computingSignal = signal;
      return new Promise<never>(() => {});
    });
    const request = cache.run(source, "abandoned", controller.signal, compute);
    await Promise.resolve();
    controller.abort();
    expect((await request).ok).toBe(false);
    await Promise.resolve();
    expect(computingSignal?.aborted).toBe(true);
    const failed = vi.fn(async () =>
      failure({ code: "PROCESSING_FAILED" as const, message: "test" }),
    );
    const signal = new AbortController().signal;
    await cache.run(source, "failed", signal, failed);
    await cache.run(source, "failed", signal, failed);
    expect(failed).toHaveBeenCalledTimes(2);
  });
});
