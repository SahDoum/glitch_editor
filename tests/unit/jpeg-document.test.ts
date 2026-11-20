import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  applyBlockPermutationOperation,
  applyCoefficientGlitchOperation,
  applyBlockTransferOperation,
  applyQuantizationOperation,
  applyBlockRepeatOperation,
  applyBlockShiftOperation,
  createJpegDocumentSession,
} from "../../src/application/jpeg-document";
import {
  createRectangleSelection,
  createSpatialMask,
  createBrushMask,
  copySpatialMask,
  getMaskFromParameters,
} from "../../src/document/masks";
import { OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";

describe("JPEG document operation session", () => {
  it.each([
    "low-pass",
    "ringing-boost",
    "engrave-horizontal",
    "engrave-vertical",
  ] as const)(
    "replays %s through undo, redo, and a restored operation stack",
    async (mode) => {
      const bytes = new Uint8Array(
        await readFile(
          new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
        ),
      );
      const inspection = inspectJpeg(bytes);
      const asset = OriginalAsset.create({
        fileName: "input.jpg",
        sha256: "a".repeat(64),
        bytes,
      });
      if (!inspection.ok || !asset.ok) throw new Error("fixture");
      const imported = {
        originalAsset: asset.value,
        inspection: inspection.value,
        previewUrl: "blob:local-test",
      };
      const session = createJpegDocumentSession(imported);
      const restored = createJpegDocumentSession(imported);
      if (!session.ok || !restored.ok) throw new Error("session");
      const selection = createRectangleSelection(0, 0, 16, 16, 16, 16);
      if (!selection.ok || !selection.value) throw new Error("selection");
      const mask = createSpatialMask(selection.value, 16, 16);
      if (!mask.ok) throw new Error(mask.error.message);
      const history = session.value;
      expect(
        applyCoefficientGlitchOperation(history, {
          kind: "coefficients",
          mask: mask.value,
          componentIndex: 0,
          domain: "ac",
          mode,
          frequencyBand: "all",
          strength: 4,
          seed: 1,
        }).ok,
      ).toBe(true);
      expect(history.undo().ok).toBe(true);
      expect(history.snapshot.currentState.jpegOperations).toHaveLength(0);
      expect(history.redo().ok).toBe(true);
      expect(
        restored.value.restoreOperations(history.snapshot.operations).ok,
      ).toBe(true);
      expect(restored.value.snapshot.currentState.jpegOperations).toEqual(
        history.snapshot.currentState.jpegOperations,
      );
      expect(history.snapshot.originalAsset.readBytes()).toEqual(bytes);
    },
  );
  it("replays DC steps through undo, redo, and a restored operation stack", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "input.jpg",
      sha256: "a".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");
    const imported = {
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    };
    const session = createJpegDocumentSession(imported);
    const restored = createJpegDocumentSession(imported);
    if (!session.ok || !restored.ok) throw new Error("session");
    const selection = createRectangleSelection(0, 0, 16, 16, 16, 16);
    if (!selection.ok || !selection.value) throw new Error("selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const history = session.value;
    expect(
      applyCoefficientGlitchOperation(history, {
        kind: "coefficients",
        mask: mask.value,
        componentIndex: 0,
        domain: "dc",
        mode: "dc-steps",
        frequencyBand: "all",
        strength: 32,
        seed: 1,
      }).ok,
    ).toBe(true);
    expect(history.undo().ok).toBe(true);
    expect(history.snapshot.currentState.jpegOperations).toHaveLength(0);
    expect(history.redo().ok).toBe(true);
    expect(
      restored.value.restoreOperations(history.snapshot.operations).ok,
    ).toBe(true);
    expect(restored.value.snapshot.currentState.jpegOperations).toEqual(
      history.snapshot.currentState.jpegOperations,
    );
    expect(history.snapshot.originalAsset.readBytes()).toEqual(bytes);
  });
  it("replays and restores a masked block shift without changing the source", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
      ),
    );
    const original = bytes.slice();
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-444.jpg",
      sha256: "f".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");
    const session = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    if (!session.ok) throw new Error(session.error.message);
    const selection = createRectangleSelection(0, 0, 16, 16, 16, 16);
    if (!selection.ok || !selection.value) throw new Error("selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const history = session.value;
    expect(
      applyBlockShiftOperation(history, {
        kind: "block-shift",
        componentIndex: 1,
        mask: mask.value,
        offsetX: 1,
        offsetY: -1,
      }).ok,
    ).toBe(true);
    expect(history.snapshot.currentState.jpegOperations).toMatchObject([
      {
        kind: "block-shift",
        offsetX: 1,
        offsetY: -1,
        mask: { id: mask.value.id },
      },
    ]);
    expect(history.undo().ok).toBe(true);
    expect(history.snapshot.currentState.jpegOperations).toHaveLength(0);
    expect(history.redo().ok).toBe(true);
    expect(history.snapshot.currentState.jpegOperations).toHaveLength(1);
    const restored = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    if (!restored.ok) throw new Error(restored.error.message);
    expect(
      restored.value.restoreOperations(history.snapshot.operations).ok,
    ).toBe(true);
    expect(restored.value.snapshot.currentState.jpegOperations).toEqual(
      history.snapshot.currentState.jpegOperations,
    );
    expect(history.snapshot.originalAsset.readBytes()).toEqual(original);
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
        operations: [{ type: "coefficients", status: "applied" }],
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

  it("restores a seeded JPEG operation and its immutable mask against the same source", async () => {
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

    const imported = {
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    };
    const originalSession = createJpegDocumentSession(imported);
    if (!originalSession.ok) throw new Error(originalSession.error.message);
    const mask = createSpatialMask(
      {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 0,
        y: 0,
        width: 8,
        height: 8,
      },
      inspection.value.width,
      inspection.value.height,
    );
    if (!mask.ok) throw new Error(mask.error.message);
    expect(
      applyCoefficientGlitchOperation(originalSession.value, {
        kind: "coefficients",
        mask: mask.value,
        componentIndex: 0,
        domain: "ac",
        mode: "randomize",
        frequencyBand: "mid",
        strength: 8,
        seed: 137,
      }).ok,
    ).toBe(true);
    const savedOperations = originalSession.value.snapshot.operations;

    const reopenedSession = createJpegDocumentSession(imported);
    if (!reopenedSession.ok) throw new Error(reopenedSession.error.message);
    const restored = reopenedSession.value.restoreOperations(savedOperations);

    expect(restored).toMatchObject({
      ok: true,
      value: {
        currentState: {
          jpegOperations: [
            {
              mode: "randomize",
              frequencyBand: "mid",
              seed: 137,
            },
          ],
        },
        operations: [
          {
            type: "coefficients",
            status: "applied",
            seed: 137,
          },
        ],
      },
    });
    expect(reopenedSession.value.snapshot.originalAsset.readBytes()).toEqual(
      bytes,
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
          jpegOperations: [
            {
              kind: "block-permutation",
              componentIndex: 0,
              mask: { id: mask.value.id },
              seed: 42,
            },
          ],
        },
        operations: [{ type: "block-permutation", status: "applied" }],
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

  it("adds a same-component block transfer as one undoable operation", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const original = bytes.slice();
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "c".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("Invalid JPEG fixture.");
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    if (!created.ok) throw new Error(created.error.message);
    const history = created.value;

    const applied = applyBlockTransferOperation(history, {
      kind: "block-transfer",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      width: 1,
      height: 1,
      destinationX: 1,
      destinationY: 0,
      mode: "ac",
      action: "copy",
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        currentState: {
          jpegOperations: [
            {
              kind: "block-transfer",
              sourceX: 0,
              destinationX: 1,
              mode: "ac",
              action: "copy",
            },
          ],
        },
        operations: [{ type: "block-transfer", status: "applied" }],
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
          jpegOperations: [{ kind: "block-transfer", mode: "ac" }],
        },
      },
    });
    expect(Array.from(history.snapshot.originalAsset.readBytes())).toEqual(
      Array.from(original),
    );
  });

  it("recovers independent masks from coefficient and disabled shuffle entries", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-420.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-420.jpg",
      sha256: "c".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("Invalid JPEG fixture.");
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    if (!created.ok) throw new Error(created.error.message);
    const history = created.value;
    const mask = createBrushMask([{ x: 4, y: 4 }], 4, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const coefficient = applyCoefficientGlitchOperation(history, {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "zero",
      frequencyBand: "all",
      strength: 0,
      seed: 1,
    });
    const shuffle = applyBlockPermutationOperation(history, {
      kind: "block-permutation",
      mask: mask.value,
      componentIndex: 0,
      seed: 1,
    });
    for (const result of [coefficient, shuffle]) {
      if (!result.ok) throw new Error(result.error.message);
    }
    const shuffleId = history.snapshot.operations[1]!.id;
    const disabled = history.setEnabled(shuffleId, false);
    if (!disabled.ok) throw new Error(disabled.error.message);
    const before = history.snapshot;
    expect(before.operations.map((operation) => operation.type)).toEqual([
      "coefficients",
      "block-permutation",
    ]);
    expect(before.operations[1]!.enabled).toBe(false);
    for (const operation of before.operations) {
      const snapshot = getMaskFromParameters(operation.parameters);
      if (!snapshot) throw new Error("Expected mask snapshot");
      const copy = copySpatialMask(snapshot);
      if (!copy.ok) throw new Error(copy.error.message);
      expect(copy.value.shapes).toEqual(mask.value.shapes);
      expect(copy.value.id).not.toBe(mask.value.id);
    }
    expect(history.snapshot).toBe(before);
    const originalSnapshot = getMaskFromParameters(
      before.operations[0]!.parameters,
    );
    if (!originalSnapshot) throw new Error("Expected mask snapshot");
    const copy = copySpatialMask(originalSnapshot);
    if (!copy.ok) throw new Error(copy.error.message);
    expect(copy.value.id).not.toBe(originalSnapshot.id);
    expect(copy.value.shapes).toEqual(originalSnapshot.shapes);
    expect(history.snapshot).toBe(before);
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
  it("checks the final active plan before enabling or restoring, without mutating history", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-grayscale.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "source.jpg",
      sha256: "a".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
    });
    if (!created.ok) throw new Error("session");
    const mask = createBrushMask(
      [{ x: 2, y: 2 }],
      1,
      inspection.value.width,
      inspection.value.height,
    );
    if (!mask.ok) throw new Error("mask");
    const applied = applyCoefficientGlitchOperation(created.value, {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "zero",
      frequencyBand: "all",
      strength: 0,
      seed: 1,
    });
    if (!applied.ok) throw new Error(applied.error.message);
    const record = applied.value.operations[0]!;
    const records = Array.from({ length: 257 }, (_, index) => ({
      ...record,
      id: `operation-${index}`,
      enabled: index < 256,
    }));
    expect(created.value.restoreOperations(records).ok).toBe(true);
    expect(created.value.snapshot.currentState.jpegOperations).toHaveLength(
      256,
    );
    const before = created.value.snapshot;
    expect(created.value.setEnabled("operation-256", true)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(created.value.snapshot).toBe(before);
    expect(created.value.canUndo).toBe(false);
    expect(
      created.value.restoreOperations(
        records.map((record) => ({ ...record, enabled: true })),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(created.value.snapshot).toBe(before);
    expect(Object.isFrozen(before.operations[0])).toBe(true);
    expect(Object.isFrozen(before.operations[0]!.parameters)).toBe(true);
  });

  it("keeps existing record metadata and identity stable when the plan changes", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-grayscale.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "source.jpg",
      sha256: "a".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");
    const created = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
    });
    if (!created.ok) throw new Error("session");
    const mask = createBrushMask(
      [{ x: 2, y: 2 }],
      1,
      inspection.value.width,
      inspection.value.height,
    );
    if (!mask.ok) throw new Error("mask");
    const input = {
      kind: "coefficients" as const,
      mask: mask.value,
      componentIndex: 0,
      domain: "ac" as const,
      mode: "zero" as const,
      frequencyBand: "all" as const,
      strength: 0,
      seed: 1,
    };
    expect(applyCoefficientGlitchOperation(created.value, input).ok).toBe(true);
    const record = created.value.snapshot.operations[0]!;
    expect(applyCoefficientGlitchOperation(created.value, input).ok).toBe(true);
    expect(created.value.snapshot.operations[0]).toBe(record);
    expect(record.inputRevision).toBe(0);
    expect(created.value.undo().ok).toBe(true);
    expect(created.value.snapshot.operations[0]).toBe(record);
    expect(created.value.snapshot.revision).toBeGreaterThan(1);
    expect(created.value.redo().ok).toBe(true);
    expect(created.value.snapshot.operations[0]).toBe(record);
  });
});
