import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJpegPreviewUrl,
  decodeJpegFrame,
  encodeJpegFrame,
} from "../../src/application/jpeg-result";
import { EncodingPlanCache } from "../../src/application/encoding-plan";
import { OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { identifyJpegColorModel } from "../../src/jpeg/color-model";
import { success } from "../../src/shared/result";
import { encodeJpegCoefficients } from "../../src/application/coefficient-reader";

vi.mock("../../src/application/coefficient-reader", () => ({
  encodeJpegCoefficients: vi.fn(),
}));

async function source() {
  const bytes = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
    ),
  );
  const inspection = inspectJpeg(bytes);
  const originalAsset = OriginalAsset.create({
    bytes,
    fileName: "test.jpg",
    sha256: "0".repeat(64),
  });
  if (!inspection.ok || !originalAsset.ok) throw new Error("fixture");
  return {
    inspection: inspection.value,
    originalAsset: originalAsset.value,
    previewUrl: "blob:original",
    orientation: 1 as const,
    colorModel: identifyJpegColorModel(bytes, inspection.value),
  };
}

function preview(decode: () => Promise<void>, width = 16, height = 16) {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:preview");
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = width;
      naturalHeight = height;
      decode = decode;
    },
  );
  return { create, revoke };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(encodeJpegCoefficients).mockReset();
});

describe("encoded JPEG publication boundary", () => {
  it("uses the exact byte view and keeps the Blob immutable without a staging copy", async () => {
    const { create } = preview(async () => {});
    const bytes = new Uint8Array([9, 1, 2, 8]);
    createJpegPreviewUrl(bytes.subarray(1, 3));
    const blob = create.mock.calls[0]?.[0];
    if (!(blob instanceof Blob)) throw new Error("blob");
    bytes.fill(0);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2]),
    );
  });

  it("retains exportable bytes if URL allocation fails", async () => {
    const { create } = preview(async () => {});
    create.mockImplementation(() => {
      throw new Error("URL allocation failed");
    });
    const bytes = new Uint8Array([1, 2]);
    const frame = await decodeJpegFrame(
      await source(),
      1,
      bytes,
      new AbortController().signal,
    );
    expect(frame).toMatchObject({
      bytes,
      url: null,
      displayError: "The browser could not show the encoded JPG.",
    });
  });

  it("revokes invalid dimension previews and retains encoded bytes", async () => {
    const { revoke } = preview(async () => {}, 20, 20);
    const bytes = new Uint8Array([1]);
    const frame = await decodeJpegFrame(
      await source(),
      1,
      bytes,
      new AbortController().signal,
    );
    expect(frame?.bytes).toBe(bytes);
    expect(frame?.url).toBe(null);
    expect(frame?.displayError).toContain("dimensions");
    expect(revoke).toHaveBeenCalledWith("blob:preview");
  });

  it("keeps cancellation ownership through pending browser decoding", async () => {
    let finishDecode!: () => void;
    const { revoke } = preview(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );
    const controller = new AbortController();
    const request = decodeJpegFrame(
      await source(),
      1,
      new Uint8Array([1]),
      controller.signal,
    );
    controller.abort();
    finishDecode();
    expect(await request).toBe(null);
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("reuses Preview encoding for Apply through the real frame pipeline", async () => {
    const imported = await source();
    const { create } = preview(
      async () => {},
      imported.inspection.width,
      imported.inspection.height,
    );
    const bytes = new Uint8Array([1, 2]);
    vi.mocked(encodeJpegCoefficients).mockResolvedValue(success(bytes));
    const cache = new EncodingPlanCache();
    const signal = new AbortController().signal;
    const before = imported.originalAsset.readBytes();
    const draft = await encodeJpegFrame(imported, 1, [], signal, cache);
    const applied = await encodeJpegFrame(imported, 1, [], signal, cache);
    expect(
      draft.ok && applied.ok && applied.value.bytes === draft.value.bytes,
    ).toBe(true);
    expect(encodeJpegCoefficients).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
    expect(imported.originalAsset.readBytes()).toEqual(before);
  });
});
