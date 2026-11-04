import { describe, expect, it } from "vitest";
import { OriginalAsset, createProjectDocument } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { readFile } from "node:fs/promises";

describe("original assets and project documents", () => {
  it("keeps a private copy of the exact source bytes", () => {
    const imported = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const asset = OriginalAsset.create({
      fileName: "tiny.jpg",
      sha256: "a".repeat(64),
      bytes: imported,
    });

    expect(asset.ok).toBe(true);
    if (!asset.ok) return;

    imported[0] = 0;
    const exposedCopy = asset.value.readBytes();
    exposedCopy[1] = 0;

    expect(Array.from(asset.value.readBytes())).toEqual([
      0xff, 0xd8, 0xff, 0xd9,
    ]);
    expect(Object.isFrozen(asset.value)).toBe(true);
  });

  it("rejects invalid source metadata and empty byte arrays", () => {
    expect(
      OriginalAsset.create({
        fileName: "   ",
        sha256: "not-a-digest",
        bytes: new Uint8Array(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("creates an initial project document with an untouched source state", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-grayscale.jpg", import.meta.url),
      ),
    );
    const inspected = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-grayscale.jpg",
      sha256: "b".repeat(64),
      bytes,
    });
    expect(inspected.ok).toBe(true);
    expect(asset.ok).toBe(true);
    if (!inspected.ok || !asset.ok) return;

    const initialState = Object.freeze({ activeMask: null });
    const document = createProjectDocument(
      asset.value,
      inspected.value,
      initialState,
    );

    expect(document).toMatchObject({
      revision: 0,
      currentState: initialState,
      operations: [],
      originalAsset: asset.value,
    });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Array.from(document.originalAsset.readBytes())).toEqual(
      Array.from(bytes),
    );
  });
});
