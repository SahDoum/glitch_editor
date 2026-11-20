import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { corruptEncodedJpeg } from "../../src/application/scan-corruption";
import type { ScanCorruptionParameters } from "../../src/jpeg/scan-corruption";

class MockWorker {
  static latest: MockWorker;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: { bytes: ArrayBuffer } | null = null;
  transfer: Transferable[] = [];
  terminate = vi.fn();
  constructor() {
    MockWorker.latest = this;
  }
  postMessage(request: { bytes: ArrayBuffer }, transfer: Transferable[]) {
    this.request = request;
    this.transfer = transfer;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}
const stage: ScanCorruptionParameters = {
  mode: "bit-flip",
  count: 2,
  rangeStart: 0,
  rangeEnd: 1,
  seed: 12,
};
const source = Uint8Array.of(0xff, 0xd8, 0, 0, 0xff, 0xd9);
function validResponse() {
  return {
    id: 0,
    result: {
      ok: true,
      value: {
        type: "corrupted",
        bytes: source.slice().buffer,
        reports: [
          {
            ...stage,
            scanStartOffset: 2,
            scanEndOffset: 4,
            changedBytes: 2,
            changedBits: 2,
          },
        ],
        diagnostic: {
          decoder: "libjpeg-turbo",
          status: "complete",
          decodedRows: 1,
          expectedRows: 1,
          warningCount: 0,
          warningFlags: 0,
          message: "",
        },
      },
    },
  };
}
beforeEach(() => vi.stubGlobal("Worker", MockWorker));
afterEach(() => vi.unstubAllGlobals());

describe("Scan Corrupt worker facade", () => {
  it.each([
    null,
    {},
    { id: 0 },
    { id: 0, result: null },
    { id: 0, result: {} },
    { id: 0, result: { ok: false } },
    { id: 0, result: { ok: false, error: { code: "BAD", message: "bad" } } },
    { id: 0, result: { ok: true } },
    { id: 0, result: { ok: true, value: null } },
    { id: 1, result: { ok: true, value: {} } },
  ])("settles malformed responses without throwing: %j", async (response) => {
    const result = corruptEncodedJpeg(source, [stage]);
    const worker = MockWorker.latest;
    expect(() => worker.reply(response)).not.toThrow();
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "PROCESSING_FAILED" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it.each(["diagnostic", "reports", "bytes"])(
    "rejects invalid success payload %s",
    async (field) => {
      const response = validResponse();
      if (field === "diagnostic")
        response.result.value.diagnostic.decodedRows = -1;
      if (field === "reports")
        response.result.value.reports[0]!.changedBits = 50;
      if (field === "bytes") response.result.value.bytes = new ArrayBuffer(1);
      const result = corruptEncodedJpeg(source, [stage]);
      MockWorker.latest.reply(response);
      expect(await result).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
    },
  );

  it("transfers a private source copy and accepts verified reports and bytes", async () => {
    const before = source.slice();
    const result = corruptEncodedJpeg(source, [stage]);
    const worker = MockWorker.latest;
    expect(worker.transfer).toEqual([worker.request!.bytes]);
    new Uint8Array(worker.request!.bytes)[0] = 0;
    expect(source).toEqual(before);
    worker.reply(validResponse());
    expect(await result).toMatchObject({ ok: true, value: { bytes: source } });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("compares replies to the stage snapshot sent to the worker", async () => {
    const draft = { ...stage };
    const stages = [draft];
    const result = corruptEncodedJpeg(source, stages);
    draft.seed = 999;
    stages.length = 0;
    MockWorker.latest.reply(validResponse());
    expect(await result).toMatchObject({ ok: true });
  });

  it("propagates structured worker failures", async () => {
    const result = corruptEncodedJpeg(source, [stage]);
    MockWorker.latest.reply({
      id: 0,
      result: {
        ok: false,
        error: { code: "UNSUPPORTED_FORMAT", message: "unsupported" },
      },
    });
    expect(await result).toEqual({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT", message: "unsupported" },
    });
  });

  it("cancels once, removes listeners, and ignores a queued late result", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = corruptEncodedJpeg(source, [stage], controller.signal);
    const worker = MockWorker.latest;
    const queuedHandler = worker.onmessage!;
    controller.abort();
    queuedHandler({ data: validResponse() } as MessageEvent<unknown>);
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.each(["error", "messageerror"])(
    "settles worker %s and clears handlers",
    async (kind) => {
      const result = corruptEncodedJpeg(source, [stage]);
      const worker = MockWorker.latest;
      if (kind === "error")
        worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
      else worker.onmessageerror?.();
      expect(await result).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(worker.onmessage).toBeNull();
    },
  );
});
