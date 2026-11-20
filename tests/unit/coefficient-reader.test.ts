import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeJpegCoefficients,
  createJpegCoefficientReader,
} from "../../src/application/coefficient-reader";
import { createFullImageMask } from "../../src/document/masks";
import type { CoefficientWorkerResponse } from "../../src/jpeg/coefficient-worker-protocol";
import type { JpegBlockGeometry } from "../../src/jpeg/block-geometry";
import type { JpegGlitchOperation } from "../../src/operations/jpeg-glitch";

class MockWorker {
  static latest: MockWorker;
  onmessage: ((event: MessageEvent<CoefficientWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: unknown;
  terminate = vi.fn();
  constructor() {
    MockWorker.latest = this;
  }
  postMessage(request: unknown) {
    this.request = structuredClone(request);
  }
}

const geometry: JpegBlockGeometry = {
  width: 8,
  height: 8,
  components: [
    { id: 1, horizontalSampling: 1, verticalSampling: 1, quantizationTable: 0 },
  ],
};

function operation(): JpegGlitchOperation {
  const mask = createFullImageMask(8, 8);
  if (!mask.ok) throw new Error("mask");
  return {
    kind: "coefficients",
    componentIndex: 0,
    mask: mask.value,
    domain: "ac",
    mode: "zero",
    frequencyBand: "all",
    strength: 0,
    seed: 1,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("coefficient worker facade", () => {
  it("sends operation data and a copy of the source; cancellation ignores late results", async () => {
    vi.stubGlobal("Worker", MockWorker);
    const source = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const controller = new AbortController();
    const result = encodeJpegCoefficients(
      source,
      geometry,
      [operation()],
      controller.signal,
    );
    const worker = MockWorker.latest;
    expect(worker.request).toMatchObject({
      type: "encode",
      operations: [{ kind: "coefficients" }],
    });
    expect(worker.request).not.toHaveProperty("commands");
    const posted = worker.request as { bytes: ArrayBuffer };
    new Uint8Array(posted.bytes)[0] = 0;
    expect(source[0]).toBe(0xff);
    controller.abort();
    worker.onmessage?.({
      data: {
        id: 0,
        result: {
          ok: true,
          value: { type: "encoded", bytes: new ArrayBuffer(1) },
        },
      },
    } as MessageEvent<CoefficientWorkerResponse>);
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(source).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });
  it("binds a reader to an immutable source and opens only once", async () => {
    vi.stubGlobal("Worker", MockWorker);
    const bytes = new Uint8Array([0xff, 0xd8]);
    const reader = createJpegCoefficientReader(bytes);
    if (!reader.ok) throw new Error(reader.error.message);
    bytes[0] = 0;
    const first = reader.value.open();
    const worker = MockWorker.latest;
    expect(
      new Uint8Array((worker.request as { bytes: ArrayBuffer }).bytes)[0],
    ).toBe(0xff);
    const second = reader.value.open();
    worker.onmessage?.({
      data: { id: 0, result: { ok: true, value: { type: "opened" } } },
    } as MessageEvent<CoefficientWorkerResponse>);
    expect(await first).toEqual({ ok: true, value: undefined });
    expect(await second).toEqual({ ok: true, value: undefined });
    await reader.value.open();
    expect((worker.request as { id: number }).id).toBe(0);
    reader.value.close();
    expect(await reader.value.open()).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(["error", "messageerror", "malformed", "send"])(
    "terminates every pending request once after %s",
    async (mode) => {
      vi.stubGlobal("Worker", MockWorker);
      const created = createJpegCoefficientReader(new Uint8Array([0xff, 0xd8]));
      if (!created.ok) throw new Error(created.error.message);
      const reader = created.value;
      const worker = MockWorker.latest;
      const open = reader.open();
      worker.onmessage?.({
        data: { id: 0, result: { ok: true, value: { type: "opened" } } },
      } as MessageEvent<CoefficientWorkerResponse>);
      expect((await open).ok).toBe(true);
      if (mode === "send")
        vi.spyOn(worker, "postMessage").mockImplementation(() => {
          throw new Error("clone");
        });
      const first = reader.readBlock(0, 0, 0);
      const second = reader.readBlock(0, 1, 0);
      if (mode !== "send")
        await vi.waitFor(() => expect(worker.request).toMatchObject({ id: 2 }));
      if (mode === "error")
        worker.onerror?.({ preventDefault() {} } as ErrorEvent);
      if (mode === "messageerror") worker.onmessageerror?.();
      if (mode === "malformed")
        worker.onmessage?.({
          data: { id: 1 },
        } as MessageEvent<CoefficientWorkerResponse>);
      expect(await first).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(await second).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(await reader.open()).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(await reader.readBlock(0, 0, 0)).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      reader.close();
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(worker.onmessage).toBeNull();
    },
  );

  it.each([
    undefined,
    { ok: true },
    { ok: false },
    { ok: true, value: { type: "encoded" } },
  ])("rejects incomplete encoder response %j", async (result) => {
    vi.stubGlobal("Worker", MockWorker);
    const pending = encodeJpegCoefficients(
      new Uint8Array([0xff, 0xd8]),
      geometry,
      [operation()],
    );
    const worker = MockWorker.latest;
    worker.onmessage?.({
      data: { id: 0, result },
    } as MessageEvent<CoefficientWorkerResponse>);
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "PROCESSING_FAILED" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("makes failed open terminal and permits a fresh reader", async () => {
    vi.stubGlobal("Worker", MockWorker);
    const first = createJpegCoefficientReader(new Uint8Array([0xff, 0xd8]));
    if (!first.ok) throw new Error(first.error.message);
    const pending = first.value.readBlock(0, 0, 0);
    const worker = MockWorker.latest;
    worker.onmessage?.({
      data: {
        id: 0,
        result: {
          ok: false,
          error: { code: "MALFORMED_JPEG", message: "Invalid JPEG." },
        },
      },
    } as MessageEvent<CoefficientWorkerResponse>);
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });
    expect(await first.value.open()).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    const second = createJpegCoefficientReader(new Uint8Array([0xff, 0xd8]));
    expect(second.ok).toBe(true);
    expect(MockWorker.latest).not.toBe(worker);
    if (second.ok) second.value.close();
  });

  it("settles pending open and block reads when closed before open responds", async () => {
    vi.stubGlobal("Worker", MockWorker);
    const created = createJpegCoefficientReader(new Uint8Array([0xff, 0xd8]));
    if (!created.ok) throw new Error(created.error.message);
    const open = created.value.open();
    const block = created.value.readBlock(0, 0, 0);
    const worker = MockWorker.latest;
    const lateResponse = worker.onmessage;
    created.value.close();
    lateResponse?.({
      data: { id: 0, result: { ok: true, value: { type: "opened" } } },
    } as MessageEvent<CoefficientWorkerResponse>);
    expect(await open).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(await block).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(["bad", 1, true, false, null, undefined])(
    "settles a primitive encoder envelope %j",
    async (data) => {
      vi.stubGlobal("Worker", MockWorker);
      const pending = encodeJpegCoefficients(
        new Uint8Array([0xff, 0xd8]),
        geometry,
        [operation()],
      );
      const worker = MockWorker.latest;
      expect(() =>
        worker.onmessage?.(
          new MessageEvent("message", {
            data,
          }) as unknown as MessageEvent<CoefficientWorkerResponse>,
        ),
      ).not.toThrow();
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );
});
