import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createJpegDocumentSession } from "../../src/application/jpeg-document";
import { getJpegOperationEffect } from "../../src/features/effects/registry";

function jpegController(id: string) {
  const effect = getJpegOperationEffect(id);
  if (!effect) throw new Error(`${id} controller`);
  return effect.controller;
}
import { createFullImageMask } from "../../src/document/masks";
import { OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";

describe("effect controllers", () => {
  it("validate and dispatch JPEG-domain parameters through the document model", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-444.jpg",
      sha256: "a".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");

    const history = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    const mask = createFullImageMask(
      inspection.value.width,
      inspection.value.height,
    );
    if (!history.ok || !mask.ok) throw new Error("fixture session");

    const coefficientController = jpegController("pixelate");
    const coefficientResult = coefficientController.execute(
      history.value,
      {
        kind: "coefficients",
        mask: mask.value,
        componentIndex: 0,
        domain: "ac",
        mode: "zero",
        frequencyBand: "all",
        strength: 0,
        seed: 1,
      },
      inspection.value,
    );
    expect(coefficientResult.ok).toBe(true);

    const blockResult = jpegController("local-shift").execute(
      history.value,
      {
        kind: "block-shift",
        componentIndex: 0,
        mask: mask.value,
        offsetX: 1,
        offsetY: 0,
      },
      inspection.value,
    );
    expect(blockResult.ok).toBe(true);

    const table = inspection.value.quantizationTables[0];
    if (!table) throw new Error("fixture table");
    const quantizationResult = jpegController("quantization").execute(
      history.value,
      {
        kind: "quantization",
        tableId: table.id,
        values: table.values,
        semantics: "reinterpret",
        pattern: "manual",
        seed: 1,
      },
      inspection.value,
    );
    expect(quantizationResult.ok).toBe(true);
    expect(
      history.value.snapshot.currentState.jpegOperations.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["coefficients", "block-shift", "quantization"]);
  });

  it("rejects malformed controller parameters without changing history", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
      ),
    );
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "synthetic-color-444.jpg",
      sha256: "b".repeat(64),
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");

    const history = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
      previewUrl: "blob:local-test",
    });
    if (!history.ok) throw new Error("fixture session");

    const mask = createFullImageMask(
      inspection.value.width,
      inspection.value.height,
    );
    if (!mask.ok) throw new Error("fixture mask");
    const pixelateController = jpegController("pixelate");
    expect(
      pixelateController.execute(history.value, {}, inspection.value).ok,
    ).toBe(false);
    expect(
      pixelateController.execute(
        history.value,
        {
          kind: "coefficients",
          mask: mask.value,
          componentIndex: 0,
          domain: "ac",
          mode: "scale",
          frequencyBand: "all",
          strength: 2,
          seed: 1,
        },
        inspection.value,
      ).ok,
    ).toBe(false);
    expect(
      jpegController("block-repeat").execute(
        history.value,
        { kind: "unsupported" },
        inspection.value,
      ).ok,
    ).toBe(false);
    expect(
      jpegController("block-transfer").execute(
        history.value,
        {
          kind: "block-shift",
          componentIndex: 0,
          mask: mask.value,
          offsetX: 1,
          offsetY: 0,
        },
        inspection.value,
      ).ok,
    ).toBe(false);
    expect(
      jpegController("quantization").execute(
        history.value,
        {},
        inspection.value,
      ).ok,
    ).toBe(false);
    expect(history.value.snapshot.currentState.jpegOperations).toHaveLength(0);
  });
});
