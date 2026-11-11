import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeJpegCoefficients } from "../../src/application/coefficient-reader";
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
});
