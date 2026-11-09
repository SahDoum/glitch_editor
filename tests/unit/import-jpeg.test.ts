import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importJpeg } from "../../src/application/import-jpeg";
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
});
