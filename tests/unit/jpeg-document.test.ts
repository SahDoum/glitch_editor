import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  applyMaskToDocument,
  createJpegDocumentSession,
} from "../../src/application/jpeg-document";
import {
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";
import { OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";

describe("JPEG document operation session", () => {
  it("applies, disables, undoes, and redoes a spatial mask without changing source bytes", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const original = bytes.slice();
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "d".repeat(64),
      bytes,
    });
    expect(inspection.ok).toBe(true);
    expect(asset.ok).toBe(true);
    if (!inspection.ok || !asset.ok) return;

    const imported = {
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    };
    const created = createJpegDocumentSession(imported);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const history = created.value;

    const selection = createRectangleSelection(1, 2, 9, 10, 16, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;
    expect(history.setSelection(selection.value)).toMatchObject({
      ok: true,
      value: { selection: selection.value },
    });

    const mask = createSpatialMask(selection.value, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;
    const applied = applyMaskToDocument(history, mask.value);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        currentState: {
          activeMask: { id: mask.value.id },
          masks: [{ id: mask.value.id }],
        },
        operations: [{ type: "spatial/apply-mask", status: "applied" }],
      },
    });
    if (!applied.ok) return;
    const operationId = applied.value.operations[0]!.id;

    expect(history.setEnabled(operationId, false)).toMatchObject({
      ok: true,
      value: { currentState: { activeMask: null, masks: [] } },
    });
    expect(history.undo()).toMatchObject({
      ok: true,
      value: { currentState: { activeMask: mask.value, masks: [mask.value] } },
    });
    expect(history.redo()).toMatchObject({
      ok: true,
      value: { currentState: { activeMask: null, masks: [] } },
    });
    expect(Array.from(history.snapshot.originalAsset.readBytes())).toEqual(
      Array.from(original),
    );
  });
});
