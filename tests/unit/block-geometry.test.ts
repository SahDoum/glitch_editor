import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getMaskBlockCoverage,
  getMaskBlockCoverageAtLeastHalf,
  mapJpegBlockCoordinate,
  mapJpegImagePointToBlock,
  snapSelectionToComponentBlocks,
} from "../../src/jpeg/block-geometry";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  createBrushMask,
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";

async function fixtureBytes(fileName: string): Promise<Uint8Array> {
  const buffer = await readFile(
    new URL(`../fixtures/${fileName}`, import.meta.url),
  );
  return new Uint8Array(buffer);
}

describe("JPEG block coordinates", () => {
  it("maps a luma block in 4:2:0 sampling to image and MCU coordinates", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(mapJpegBlockCoordinate(inspection.value, 1, 1, 1)).toEqual({
      ok: true,
      value: {
        componentId: 1,
        blockX: 1,
        blockY: 1,
        imageX: 8,
        imageY: 8,
        imageWidth: 8,
        imageHeight: 8,
        mcuX: 0,
        mcuY: 0,
        blockInMcuX: 1,
        blockInMcuY: 1,
      },
    });
  });

  it("maps chroma blocks to their larger image-space footprint", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(mapJpegBlockCoordinate(inspection.value, 2, 0, 0)).toMatchObject({
      ok: true,
      value: {
        imageX: 0,
        imageY: 0,
        imageWidth: 16,
        imageHeight: 16,
        mcuX: 0,
        mcuY: 0,
        blockInMcuX: 0,
        blockInMcuY: 0,
      },
    });
  });

  it("maps image clicks to the clicked component's 8×8 DCT block", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(
      mapJpegImagePointToBlock(inspection.value, 1, 8.5, 9.5),
    ).toMatchObject({
      ok: true,
      value: {
        componentId: 1,
        blockX: 1,
        blockY: 1,
        imageX: 8,
        imageY: 8,
      },
    });
    expect(mapJpegImagePointToBlock(inspection.value, 2, 15, 15)).toMatchObject(
      {
        ok: true,
        value: {
          componentId: 2,
          blockX: 0,
          blockY: 0,
          imageWidth: 16,
          imageHeight: 16,
        },
      },
    );
  });

  it("maps clicks at odd image edges and rejects points outside the image", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-odd-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(
      mapJpegImagePointToBlock(inspection.value, 1, 16.5, 8.5),
    ).toMatchObject({
      ok: true,
      value: { blockX: 2, blockY: 1, imageX: 16, imageY: 8 },
    });
    expect(mapJpegImagePointToBlock(inspection.value, 1, 17, 8)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("maps grayscale blocks one-to-one with 8×8 sample regions", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-grayscale.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(mapJpegBlockCoordinate(inspection.value, 1, 0, 0)).toMatchObject({
      ok: true,
      value: {
        imageX: 0,
        imageY: 0,
        imageWidth: 8,
        imageHeight: 8,
        mcuX: 0,
        mcuY: 0,
        blockInMcuX: 0,
        blockInMcuY: 0,
      },
    });
  });

  it.each([
    {
      file: "synthetic-color-422.jpg",
      mcuWidth: 16,
      mcuHeight: 8,
      chromaBlockWidth: 16,
      chromaBlockHeight: 8,
    },
    {
      file: "synthetic-color-444.jpg",
      mcuWidth: 8,
      mcuHeight: 8,
      chromaBlockWidth: 8,
      chromaBlockHeight: 8,
    },
  ])(
    "maps chroma blocks correctly for $file",
    async ({
      file,
      mcuWidth,
      mcuHeight,
      chromaBlockWidth,
      chromaBlockHeight,
    }) => {
      const inspection = inspectJpeg(await fixtureBytes(file));
      expect(inspection.ok).toBe(true);
      if (!inspection.ok) return;

      expect(inspection.value).toMatchObject({ mcuWidth, mcuHeight });
      expect(mapJpegBlockCoordinate(inspection.value, 2, 0, 0)).toMatchObject({
        ok: true,
        value: {
          imageX: 0,
          imageY: 0,
          imageWidth: chromaBlockWidth,
          imageHeight: chromaBlockHeight,
          mcuX: 0,
          mcuY: 0,
        },
      });
    },
  );

  it("clips visible edge blocks and excludes MCU padding from coefficient coordinates", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-odd-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection.value).toMatchObject({ width: 17, height: 9 });

    expect(mapJpegBlockCoordinate(inspection.value, 1, 2, 1)).toMatchObject({
      ok: true,
      value: {
        imageX: 16,
        imageY: 8,
        imageWidth: 1,
        imageHeight: 1,
        mcuX: 1,
        mcuY: 0,
        blockInMcuX: 0,
        blockInMcuY: 1,
      },
    });
    expect(mapJpegBlockCoordinate(inspection.value, 1, 3, 1)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects unknown components and out-of-range block coordinates", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(mapJpegBlockCoordinate(inspection.value, 99, 0, 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(mapJpegBlockCoordinate(inspection.value, 1, -1, 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(mapJpegBlockCoordinate(inspection.value, 2, 1, 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(mapJpegBlockCoordinate(inspection.value, 1, 0.5, 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("snaps a pixel selection to the selected component's block geometry", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    const selection = createRectangleSelection(8, 4, 9, 6, 16, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;

    expect(
      snapSelectionToComponentBlocks(selection.value, inspection.value, 2),
    ).toEqual({
      ok: true,
      value: {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 0,
        y: 0,
        width: 16,
        height: 16,
      },
    });
  });

  it("maps rectangular masks to visible component blocks, including odd edges", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-odd-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    const selection = createRectangleSelection(16, 8, 17, 9, 17, 9);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;
    const mask = createSpatialMask(selection.value, 17, 9);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;

    expect(getMaskBlockCoverage(mask.value, inspection.value, 1)).toMatchObject(
      { ok: true, value: new Uint8Array([0, 0, 0, 0, 0, 1]) },
    );
    expect(getMaskBlockCoverage(mask.value, inspection.value, 2)).toMatchObject(
      { ok: true, value: new Uint8Array([0, 1]) },
    );
  });

  it("maps brush coverage in image pixels to component-specific blocks", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    const mask = createBrushMask([{ x: 8, y: 8 }], 0.1, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;

    expect(getMaskBlockCoverage(mask.value, inspection.value, 1)).toMatchObject(
      { ok: true, value: new Uint8Array([1, 1, 1, 1]) },
    );
    expect(getMaskBlockCoverage(mask.value, inspection.value, 2)).toMatchObject(
      { ok: true, value: new Uint8Array([1]) },
    );
  });

  it("selects only blocks with at least half of their visible area covered", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    const halfLumaBlock = createRectangleSelection(0, 0, 4, 8, 16, 16);
    expect(halfLumaBlock.ok).toBe(true);
    if (!halfLumaBlock.ok || !halfLumaBlock.value) return;
    const lumaMask = createSpatialMask(halfLumaBlock.value, 16, 16);
    expect(lumaMask.ok).toBe(true);
    if (!lumaMask.ok) return;
    expect(
      getMaskBlockCoverageAtLeastHalf(lumaMask.value, inspection.value, 1),
    ).toMatchObject({
      ok: true,
      value: new Uint8Array([1, 0, 0, 0]),
    });

    const belowHalfChromaBlock = createRectangleSelection(0, 0, 7, 16, 16, 16);
    expect(belowHalfChromaBlock.ok).toBe(true);
    if (!belowHalfChromaBlock.ok || !belowHalfChromaBlock.value) return;
    const chromaMask = createSpatialMask(belowHalfChromaBlock.value, 16, 16);
    expect(chromaMask.ok).toBe(true);
    if (!chromaMask.ok) return;
    expect(
      getMaskBlockCoverageAtLeastHalf(chromaMask.value, inspection.value, 2),
    ).toMatchObject({ ok: true, value: new Uint8Array([0]) });
  });

  it("uses sampled brush coverage when selecting blocks for permutation", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    const mask = createBrushMask([{ x: 4, y: 4 }], 4, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;

    expect(
      getMaskBlockCoverageAtLeastHalf(mask.value, inspection.value, 1),
    ).toMatchObject({
      ok: true,
      value: new Uint8Array([1, 0, 0, 0]),
    });
  });
});
