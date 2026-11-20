import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importJpeg,
  importVerifiedProjectJpeg,
} from "../../src/application/import-jpeg";
import type { InspectWorkerRequest } from "../../src/jpeg/inspect-worker-protocol";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { fixtureWithExif } from "../helpers/oriented-fixture";

class FixtureWorker {
  static instance: FixtureWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;

  constructor() {
    FixtureWorker.instance = this;
  }

  postMessage(request: InspectWorkerRequest): void {
    const result = inspectJpeg(new Uint8Array(request.bytes));
    queueMicrotask(() => {
      this.onmessage?.(new MessageEvent("message", { data: { result } }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

class FixtureImage {
  naturalWidth = 16;
  naturalHeight = 16;
  src = "";

  async decode(): Promise<void> {}
}

describe("JPEG import", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FixtureWorker.instance = null;
  });

  it("keeps the original bytes and calculates their SHA-256 digest", async () => {
    vi.stubGlobal("Worker", FixtureWorker);
    vi.stubGlobal("Image", FixtureImage);
    const source = await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    );
    const original = Buffer.from(source);
    const file = new File([source], "synthetic-color-420.jpg", {
      type: "image/jpeg",
    });

    const result = await importJpeg(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.value.originalAsset.readBytes())).toEqual(
      original,
    );
    expect(result.value.originalAsset.sha256).toBe(
      createHash("sha256").update(original).digest("hex"),
    );
    expect(result.value.originalAsset.fileName).toBe("synthetic-color-420.jpg");
    const exposedCopy = result.value.originalAsset.readBytes();
    exposedCopy[0] = 0;
    expect(result.value.originalAsset.readBytes()[0]).toBe(original[0]);
    URL.revokeObjectURL(result.value.previewUrl);
  });

  it("imports a rotated EXIF preview without changing original bytes", async () => {
    class RotatedImage extends FixtureImage {
      override naturalWidth = 9;
      override naturalHeight = 17;
    }
    vi.stubGlobal("Image", RotatedImage);
    vi.stubGlobal("Worker", FixtureWorker);
    const source = await fixtureWithExif(6);
    const result = await importJpeg(new File([source], "rotated.jpg"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.inspection).toMatchObject({ width: 17, height: 9 });
    expect(result.value.originalAsset.readBytes()).toEqual(source);
    URL.revokeObjectURL(result.value.previewUrl);
  });

  it("returns a visible processing error when the browser cannot decode the preview", async () => {
    class BrokenImage extends FixtureImage {
      override async decode(): Promise<void> {
        throw new Error("decoder failure");
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    vi.stubGlobal("Worker", FixtureWorker);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const source = await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    );
    const file = new File([source], "broken-preview.jpg", {
      type: "image/jpeg",
    });

    const result = await importJpeg(file);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROCESSING_FAILED" },
    });
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("reports both actual and expected dimensions on a preview mismatch", async () => {
    class WrongSizeImage extends FixtureImage {
      override naturalWidth = 8;
    }
    vi.stubGlobal("Image", WrongSizeImage);
    vi.stubGlobal("Worker", FixtureWorker);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const source = await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    );
    const result = await importJpeg(new File([source], "mismatch.jpg"));
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PROCESSING_FAILED",
        message: expect.stringContaining("(8 × 16)"),
      },
    });
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("terminates a pending parser worker when import is cancelled", async () => {
    class PendingWorker extends FixtureWorker {
      override postMessage(): void {}
    }
    vi.stubGlobal("Worker", PendingWorker);
    const source = await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    );
    const file = new File([source], "synthetic-color-420.jpg", {
      type: "image/jpeg",
    });
    const controller = new AbortController();
    const pending = importJpeg(file, controller.signal);

    await vi.waitFor(() => {
      expect(FixtureWorker.instance).not.toBeNull();
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(FixtureWorker.instance?.terminated).toBe(true);
  });

  it("rejects oversized files before reading them", async () => {
    const file = new File([], "oversized.jpg");
    Object.defineProperty(file, "size", {
      value: 50 * 1024 * 1024 + 1,
    });
    const readFile = vi.spyOn(file, "arrayBuffer");

    const result = await importJpeg(file);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(readFile).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "publishes orientation %s and its color model once during import",
    async (orientation) => {
      class OrientedImage extends FixtureImage {
        override naturalWidth = orientation >= 5 ? 9 : 17;
        override naturalHeight = orientation >= 5 ? 17 : 9;
      }
      vi.stubGlobal("Image", OrientedImage);
      vi.stubGlobal("Worker", FixtureWorker);
      const source = await fixtureWithExif(orientation);
      const result = await importJpeg(new File([source], "oriented.jpg"));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.orientation).toBe(orientation);
      expect(result.value.colorModel.kind).toMatch(/ycbcr/);
      URL.revokeObjectURL(result.value.previewUrl);
    },
  );

  it("uses the integrity-checked project digest without hashing the bytes again", async () => {
    vi.stubGlobal("Worker", FixtureWorker);
    vi.stubGlobal("Image", FixtureImage);
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const digest = vi.spyOn(crypto.subtle, "digest");
    const result = await importVerifiedProjectJpeg({
      bytes,
      fileName: "project.jpg",
      sha256,
    });
    expect(result.ok).toBe(true);
    expect(digest).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.originalAsset.sha256).toBe(sha256);
    bytes[0] = 0;
    expect(result.value.originalAsset.readBytes()[0]).toBe(0xff);
    URL.revokeObjectURL(result.value.previewUrl);
  });

  it("rejects invalid EXIF before preview creation", async () => {
    vi.stubGlobal("Worker", FixtureWorker);
    const create = vi.spyOn(URL, "createObjectURL");
    const source = await fixtureWithExif(9);
    expect(await importJpeg(new File([source], "bad-exif.jpg"))).toMatchObject({
      ok: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([undefined, { ok: true }, { ok: false }, { ok: true, value: {} }])(
    "settles malformed inspector responses (%j)",
    async (result) => {
      class MalformedWorker extends FixtureWorker {
        override postMessage(): void {
          queueMicrotask(() =>
            this.onmessage?.(new MessageEvent("message", { data: { result } })),
          );
        }
      }
      vi.stubGlobal("Worker", MalformedWorker);
      const bytes = new Uint8Array([0xff, 0xd8]);
      expect(await importJpeg(new File([bytes], "input.jpg"))).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(FixtureWorker.instance?.terminated).toBe(true);
    },
  );

  it("cancels while Image.decode is pending and revokes the owned URL", async () => {
    let decodeStarted = false;
    class PendingImage extends FixtureImage {
      override decode(): Promise<void> {
        decodeStarted = true;
        return new Promise(() => {});
      }
    }
    vi.stubGlobal("Worker", FixtureWorker);
    vi.stubGlobal("Image", PendingImage);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const source = await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    );
    const controller = new AbortController();
    const pending = importJpeg(
      new File([source], "input.jpg"),
      controller.signal,
    );
    await vi.waitFor(() => expect(decodeStarted).toBe(true));
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(revoke).toHaveBeenCalledOnce();
  });
  it.each(["bad", 1, true, false, null, undefined])(
    "settles a primitive inspector envelope %j",
    async (data) => {
      class PrimitiveWorker extends FixtureWorker {
        override postMessage(): void {
          queueMicrotask(() =>
            this.onmessage?.(new MessageEvent("message", { data })),
          );
        }
      }
      vi.stubGlobal("Worker", PrimitiveWorker);
      expect(
        await importJpeg(new File([new Uint8Array([0xff, 0xd8])], "input.jpg")),
      ).toMatchObject({ ok: false, error: { code: "PROCESSING_FAILED" } });
      expect(FixtureWorker.instance?.terminated).toBe(true);
    },
  );

  it.each(["components", "markers", "quantizationTables", "scans"])(
    "rejects malformed nested inspector %s before preview",
    async (field) => {
      class MalformedInspectionWorker extends FixtureWorker {
        override postMessage(request: InspectWorkerRequest): void {
          const result = inspectJpeg(new Uint8Array(request.bytes));
          if (!result.ok) throw new Error(result.error.message);
          const response = {
            result: { ok: true, value: { ...result.value, [field]: [null] } },
          };
          queueMicrotask(() =>
            this.onmessage?.(new MessageEvent("message", { data: response })),
          );
        }
      }
      vi.stubGlobal("Worker", MalformedInspectionWorker);
      const create = vi.spyOn(URL, "createObjectURL");
      const source = await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      );
      expect(await importJpeg(new File([source], "input.jpg"))).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(FixtureWorker.instance?.terminated).toBe(true);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it("reuses the inspection from the same integrity-checked project source", async () => {
    vi.stubGlobal("Image", FixtureImage);
    const WorkerConstructor = vi.fn(() => {
      throw new Error("duplicate worker");
    });
    vi.stubGlobal("Worker", WorkerConstructor);
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    if (!inspection.ok) throw new Error(inspection.error.message);
    const digest = vi.spyOn(crypto.subtle, "digest");
    const result = await importVerifiedProjectJpeg({
      bytes,
      fileName: "project.jpg",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      inspection: inspection.value,
    });
    expect(result.ok).toBe(true);
    expect(WorkerConstructor).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.inspection).toBe(inspection.value);
    expect(result.value.originalAsset.readBytes()).toEqual(bytes);
    URL.revokeObjectURL(result.value.previewUrl);
  });

  it("keeps the parser worker in the ordinary File import path", async () => {
    vi.stubGlobal("Worker", FixtureWorker);
    vi.stubGlobal("Image", FixtureImage);
    const post = vi.spyOn(FixtureWorker.prototype, "postMessage");
    const bytes = await readFile(
      new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
    );
    const result = await importJpeg(new File([bytes], "file.jpg"));
    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledOnce();
    expect(FixtureWorker.instance?.terminated).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    URL.revokeObjectURL(result.value.previewUrl);
  });
});
