import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  applyBlockPermutationOperation,
  applyCoefficientGlitchOperation,
  applyQuantizationOperation,
  applyMaskToDocument,
  applyBlockRepeatOperation,
  createJpegDocumentSession,
} from "../../src/application/jpeg-document";
import {
  createRectangleSelection,
  createSpatialMask,
  createBrushMask,
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

  it("replays coefficient glitches and restores them through undo and redo", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const original = bytes.slice();
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "e".repeat(64),
      bytes,
    });
    expect(inspection.ok).toBe(true);
    expect(asset.ok).toBe(true);
    if (!inspection.ok || !asset.ok) return;

    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const history = created.value;
    const mask = createBrushMask([{ x: 4, y: 4 }], 3, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;

    const applied = applyCoefficientGlitchOperation(history, {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "zero",
      frequencyBand: "mid",
      strength: 0,
      seed: 1,
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        currentState: {
          jpegOperations: [
            {
              kind: "coefficients",
              mask: { id: mask.value.id },
              componentIndex: 0,
              domain: "ac",
              mode: "zero",
              frequencyBand: "mid",
              strength: 0,
              seed: 1,
            },
          ],
        },
        operations: [{ type: "jpeg/glitch/coefficients", status: "applied" }],
      },
    });

    expect(history.undo()).toMatchObject({
      ok: true,
      value: { currentState: { jpegOperations: [] } },
    });
    expect(history.redo()).toMatchObject({
      ok: true,
      value: {
        currentState: {
          jpegOperations: [{ frequencyBand: "mid", mode: "zero" }],
        },
      },
    });
    expect(Array.from(history.snapshot.originalAsset.readBytes())).toEqual(
      Array.from(original),
    );
  });

  it("rejects block repeats that leave the component block grid", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "f".repeat(64),
      bytes,
    });
    expect(inspection.ok).toBe(true);
    expect(asset.ok).toBe(true);
    if (!inspection.ok || !asset.ok) return;
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(
      applyBlockRepeatOperation(created.value, {
        kind: "block-repeat",
        componentIndex: 0,
        sourceX: 0,
        sourceY: 0,
        offsetX: 2,
        offsetY: 0,
        repetitions: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("adds a seeded whole-block permutation to the operation history", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "b".repeat(64),
      bytes,
    });
    expect(inspection.ok).toBe(true);
    expect(asset.ok).toBe(true);
    if (!inspection.ok || !asset.ok) return;
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const selection = createRectangleSelection(0, 0, 16, 16, 16, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;
    const mask = createSpatialMask(selection.value, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;

    const applied = applyBlockPermutationOperation(created.value, {
      kind: "block-permutation",
      componentIndex: 0,
      mask: mask.value,
      seed: 42,
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        currentState: {
          activeMask: { id: mask.value.id },
          jpegOperations: [
            {
              kind: "block-permutation",
              componentIndex: 0,
              mask: { id: mask.value.id },
              seed: 42,
            },
          ],
        },
        operations: [
          { type: "jpeg/glitch/block-permutation", status: "applied" },
        ],
      },
    });
    expect(created.value.undo()).toMatchObject({
      ok: true,
      value: { currentState: { jpegOperations: [] } },
    });
    expect(created.value.redo()).toMatchObject({
      ok: true,
      value: {
        currentState: {
          jpegOperations: [{ kind: "block-permutation", seed: 42 }],
        },
      },
    });
  });

  it("adds validated DQT edits as undoable JPEG operations", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "a".repeat(64),
      bytes,
    });
    expect(inspection.ok).toBe(true);
    expect(asset.ok).toBe(true);
    if (!inspection.ok || !asset.ok) return;
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const applied = applyQuantizationOperation(created.value, {
      kind: "quantization",
      tableId: inspection.value.quantizationTables[0]!.id,
      values: Array.from({ length: 64 }, () => 16),
      semantics: "reinterpret",
      pattern: "manual",
      seed: 1,
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        currentState: {
          jpegOperations: [
            {
              kind: "quantization",
              semantics: "reinterpret",
              values: Array.from({ length: 64 }, () => 16),
            },
          ],
        },
      },
    });
    expect(created.value.undo()).toMatchObject({
      ok: true,
      value: { currentState: { jpegOperations: [] } },
    });
  });
});
