import { describe, expect, it } from "vitest";
import {
  MAX_BRUSH_POINTS,
  createFullImageMask,
  createRectangleSelection,
  createSpatialMask,
  createBrushMask,
  createBrushMaskFromStrokes,
  copySpatialMask,
  getMaskFromParameters,
  isSpatialMask,
} from "../../src/document/masks";
import {
  getMaskBlockCoverage,
  getMaskBlockCoverageAtLeastHalf,
} from "../../src/jpeg/block-geometry";

describe("spatial selections and masks", () => {
  it("creates pixel-space rectangular selections from either drag direction", () => {
    expect(createRectangleSelection(12, 9, 3, 2, 20, 16)).toMatchObject({
      ok: true,
      value: {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 3,
        y: 2,
        width: 9,
        height: 7,
      },
    });
  });

  it("clips a selection to image bounds and ignores zero-area drags", () => {
    expect(createRectangleSelection(-5, 2, 25, 12, 20, 16)).toMatchObject({
      ok: true,
      value: { x: 0, y: 2, width: 20, height: 10 },
    });
    expect(createRectangleSelection(4, 4, 4, 4, 20, 16)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("validates masks in image-pixel coordinates", () => {
    const selection = createRectangleSelection(2, 3, 10, 12, 20, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;

    const mask = createSpatialMask(selection.value, 20, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;
    expect(isSpatialMask(mask.value)).toBe(true);
    expect(mask.value.shapes[0]).toMatchObject({
      kind: "rectangle",
      mode: "add",
      x: 2,
      y: 3,
      width: 8,
      height: 9,
    });

    expect(
      createSpatialMask({ ...selection.value, width: 30 }, 20, 16),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("creates a full-image mask for the All tool", () => {
    const mask = createFullImageMask(20, 16);
    expect(mask).toMatchObject({
      ok: true,
      value: {
        width: 20,
        height: 16,
        shapes: [
          {
            kind: "rectangle",
            mode: "add",
            x: 0,
            y: 0,
            width: 20,
            height: 16,
          },
        ],
      },
    });
    expect(createFullImageMask(0, 16)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("creates and validates a bounded freehand brush mask", () => {
    const mask = createBrushMask(
      [
        { x: 2, y: 3 },
        { x: 5, y: 3 },
      ],
      2,
      20,
      16,
    );
    expect(mask).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        width: 20,
        height: 16,
        shapes: [
          {
            kind: "brush",
            mode: "add",
            radius: 2,
            points: [
              { x: 2, y: 3 },
              { x: 5, y: 3 },
            ],
          },
        ],
      },
    });

    if (mask.ok) expect(isSpatialMask(mask.value)).toBe(true);

    expect(createBrushMask([{ x: 21, y: 3 }], 2, 20, 16)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(createBrushMask([{ x: 2, y: 3 }], 513, 20, 16)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("keeps gaps between brush segments in a valid single-shape mask", () => {
    const geometry = {
      width: 40,
      height: 8,
      components: [
        {
          id: 1,
          horizontalSampling: 1,
          verticalSampling: 1,
          quantizationTable: 0,
        },
      ],
    };
    const points = [
      { x: 4, y: 4 },
      { x: 36, y: 4 },
    ] as const;
    const mask = createBrushMaskFromStrokes(
      [[points[0]], [], [points[1]]],
      3.75,
      geometry.width,
      geometry.height,
    );
    if (!mask.ok) throw new Error(mask.error.message);
    expect(isSpatialMask(mask.value)).toBe(true);
    expect(mask.value.shapes).toEqual([
      { kind: "brush", mode: "add", radius: 3.75, points },
    ]);
    const coverage = { ok: true, value: Uint8Array.of(1, 0, 0, 0, 1) };
    expect(getMaskBlockCoverage(mask.value, geometry, 1)).toEqual(coverage);
    expect(getMaskBlockCoverageAtLeastHalf(mask.value, geometry, 1)).toEqual(
      coverage,
    );
    const copied = copySpatialMask(mask.value);
    if (!copied.ok) throw new Error(copied.error.message);
    expect(copied.value.shapes).toEqual(mask.value.shapes);
    expect(copied.value.id).not.toBe(mask.value.id);
  });

  it("enforces one total brush point budget across disconnected segments", () => {
    const segment = Array.from({ length: MAX_BRUSH_POINTS / 2 }, () => ({
      x: 4,
      y: 4,
    }));
    const valid = createBrushMaskFromStrokes([segment, segment], 2, 8, 8);
    if (!valid.ok) throw new Error(valid.error.message);
    expect(isSpatialMask(valid.value)).toBe(true);
    expect(
      createBrushMaskFromStrokes([segment, segment, [{ x: 4, y: 4 }]], 2, 8, 8),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("copies rectangle and brush snapshots with new identities and independent geometry", () => {
    const rectangle = createSpatialMask(
      {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 2,
        y: 3,
        width: 8,
        height: 9,
      },
      20,
      16,
    );
    const brush = createBrushMask(
      [
        { x: 2, y: 3 },
        { x: 5, y: 3 },
      ],
      2,
      20,
      16,
    );
    if (!rectangle.ok || !brush.ok) throw new Error("Expected masks");
    for (const original of [rectangle.value, brush.value]) {
      const snapshot = getMaskFromParameters({ mask: original });
      if (!snapshot) throw new Error("Expected mask snapshot");
      const copy = copySpatialMask(snapshot);
      expect(copy.ok).toBe(true);
      if (!copy.ok) throw new Error(copy.error.message);
      expect(copy.value.id).not.toBe(original.id);
      expect(copy.value.shapes).toEqual(original.shapes);
      expect(copy.value.shapes).not.toBe(original.shapes);
      expect(copy.value.shapes[0]).not.toBe(original.shapes[0]);
      expect(copy.value.width).toBe(original.width);
      expect(copy.value.height).toBe(original.height);
    }
    expect(getMaskFromParameters({ mask: { shapes: [] } })).toBeNull();
    expect(getMaskFromParameters({ kind: "block-repeat" })).toBeNull();
  });
});
