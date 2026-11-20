import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { corruptEntropyScan } from "../../src/jpeg/scan-corruption";
import * as inspection from "../../src/jpeg/inspect";
import type { ScanCorruptionWorkerResponse } from "../../src/jpeg/scan-corruption-worker-protocol";

vi.mock("../../src/jpeg/codec-loader", () => ({
  getDiagnosticCodec: vi
    .fn()
    .mockRejectedValue(new Error("unavailable in this protocol test")),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("structurally validates the initial input and every stage without re-reading each stage's input", async () => {
  const source = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    ),
  );
  const inspect = vi.spyOn(inspection, "inspectJpeg");
  const stages = Array.from({ length: 8 }, (_, seed) => ({
    mode: "bit-flip" as const,
    count: 1,
    rangeStart: 0,
    rangeEnd: 1,
    seed,
  }));
  expect(corruptEntropyScan(source, stages).ok).toBe(true);
  expect(inspect).toHaveBeenCalledTimes(stages.length + 1);
});

it("transfers owned result bytes from the worker and preserves the received clean input", async () => {
  const source = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    ),
  );
  const original = source.slice();
  const stages = [
    {
      mode: "bit-flip" as const,
      count: 2,
      rangeStart: 0,
      rangeEnd: 1,
      seed: 12,
    },
  ];
  const expected = corruptEntropyScan(source, stages);
  if (!expected.ok) throw new Error(expected.error.message);
  let handler: ((event: MessageEvent<unknown>) => Promise<void>) | undefined;
  let received: ScanCorruptionWorkerResponse | undefined;
  const postMessage = vi.fn(
    (message: ScanCorruptionWorkerResponse, transfer: Transferable[]) => {
      expect(message.result.ok).toBe(true);
      if (!message.result.ok) return;
      expect(transfer).toEqual([message.result.value.bytes]);
      received = structuredClone(message, { transfer });
      expect(message.result.value.bytes.byteLength).toBe(0);
    },
  );
  vi.stubGlobal("self", {
    addEventListener(_type: string, listener: typeof handler) {
      handler = listener;
    },
    postMessage,
  });
  await import("../../src/jpeg/scan-corruption.worker");
  expect(handler).toBeTypeOf("function");
  await handler!({
    data: { id: 4, type: "corrupt", bytes: source.buffer, stages },
  } as MessageEvent<unknown>);
  expect(postMessage).toHaveBeenCalledOnce();
  expect(received?.id).toBe(4);
  if (!received?.result.ok) throw new Error("worker returned no bytes");
  expect(new Uint8Array(received.result.value.bytes)).toEqual(
    expected.value.bytes,
  );
  expect(received.result.value.reports).toEqual(expected.value.reports);
  expect(received.result.value.diagnostic.status).toBe("unavailable");
  expect(source).toEqual(original);
});
