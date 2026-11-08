import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getMaskBlockCoverage,
  getMaskBlockCoverageAtLeastHalf,
  getMaskBlockCoveragePath,
  getJpegSelectionGridCellSize,
  mapJpegBlockDragToDestination,
  mapJpegBlockRegionToImageSelection,
  mapJpegBlockCoordinate,
  mapJpegImagePointToBlock,
  mapJpegImageRectangleToBlockRegion,
  snapImagePointToGrid,
  snapSelectionToComponentBlocks,
  snapSelectionToMcus,
  type JpegBlockGeometry,
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

  it("maps drag-selected rectangles to component blocks and back at odd edges", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-odd-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    const region = mapJpegImageRectangleToBlockRegion(
      inspection.value,
      1,
      { x: 16.5, y: 8.5 },
      { x: 8.5, y: 0.5 },
    );
    expect(region).toEqual({
      ok: true,
      value: { x: 1, y: 0, width: 2, height: 2 },
    });
    if (!region.ok) return;
    expect(
      mapJpegBlockRegionToImageSelection(inspection.value, 1, region.value),
    ).toEqual({
      ok: true,
      value: {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 8,
        y: 0,
        width: 9,
        height: 9,
      },
    });
  });

  it("maps a drag from a selected source block to a repeat destination", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-odd-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(
      mapJpegBlockDragToDestination(
        inspection.value,
        1,
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 1, y: 1 },
        { x: 9, y: 1 },
      ),
    ).toEqual({ ok: true, value: { x: 1, y: 0 } });
    expect(
      mapJpegBlockDragToDestination(
        inspection.value,
        1,
        { x: 0, y: 0, width: 2, height: 1 },
        { x: 1, y: 1 },
        { x: 9, y: 1 },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(
      mapJpegBlockDragToDestination(
        inspection.value,
        1,
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 9, y: 1 },
        { x: 17, y: 1 },
      ),
    ).toMatchObject({
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

  it("snaps brush points to the chosen component DCT grid and MCU grid", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(
      snapImagePointToGrid({ x: 14, y: 7 }, inspection.value, 1, "dct"),
    ).toEqual({ ok: true, value: { x: 12, y: 4 } });
    expect(
      snapImagePointToGrid({ x: 14, y: 7 }, inspection.value, 2, "dct"),
    ).toEqual({ ok: true, value: { x: 8, y: 8 } });
    expect(
      snapImagePointToGrid({ x: 14, y: 7 }, inspection.value, 1, "mcu"),
    ).toEqual({ ok: true, value: { x: 8, y: 8 } });
    expect(getJpegSelectionGridCellSize(inspection.value, 1, "dct")).toEqual({
      ok: true,
      value: { width: 8, height: 8 },
    });
    expect(getJpegSelectionGridCellSize(inspection.value, 2, "dct")).toEqual({
      ok: true,
      value: { width: 16, height: 16 },
    });
    expect(getJpegSelectionGridCellSize(inspection.value, 1, "mcu")).toEqual({
      ok: true,
      value: {
        width: inspection.value.mcuWidth,
        height: inspection.value.mcuHeight,
      },
    });
  });

  it("snaps odd image-edge selections and brush points to visible MCU extents", async () => {
    const inspection = inspectJpeg(
      await fixtureBytes("synthetic-color-odd-420.jpg"),
    );
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    const selection = createRectangleSelection(16, 8, 17, 9, 17, 9);
    if (!selection.ok || !selection.value)
      throw new Error("Invalid selection.");

    expect(snapSelectionToMcus(selection.value, inspection.value)).toEqual({
      ok: true,
      value: {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 16,
        y: 0,
        width: 1,
        height: 9,
      },
    });
    expect(
      snapImagePointToGrid({ x: 16.9, y: 8.9 }, inspection.value, 1, "dct"),
    ).toEqual({ ok: true, value: { x: 16.5, y: 8.5 } });
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
    expect(getMaskBlockCoveragePath(mask.value, inspection.value, 1)).toEqual({
      ok: true,
      value: "M16 8h1v1h-1z",
    });
    expect(getMaskBlockCoveragePath(mask.value, inspection.value, 2)).toEqual({
      ok: true,
      value: "M16 0h1v9h-1z",
    });
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
    expect(getMaskBlockCoveragePath(mask.value, inspection.value, 1)).toEqual({
      ok: true,
      value: "M0 0h16v8h-16zM0 8h16v8h-16z",
    });
    expect(getMaskBlockCoverage(mask.value, inspection.value, 2)).toMatchObject(
      { ok: true, value: new Uint8Array([1]) },
    );
    expect(getMaskBlockCoveragePath(mask.value, inspection.value, 2)).toEqual({
      ok: true,
      value: "M0 0h16v16h-16z",
    });

    const oneBlockMask = createBrushMask([{ x: 4, y: 4 }], 0.1, 16, 16);
    expect(oneBlockMask.ok).toBe(true);
    if (!oneBlockMask.ok) return;
    expect(
      getMaskBlockCoveragePath(oneBlockMask.value, inspection.value, 1),
    ).toEqual({ ok: true, value: "M0 0h8v8h-8z" });
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

  it("matches the original 64-sample union for varied brushes and sampling factors", () => {
    const geometry: JpegBlockGeometry = {
      width: 41,
      height: 27,
      components: [
        {
          id: 1,
          horizontalSampling: 2,
          verticalSampling: 2,
          quantizationTable: 0,
        },
        {
          id: 2,
          horizontalSampling: 1,
          verticalSampling: 1,
          quantizationTable: 1,
        },
      ],
    };
    let randomState = 123456;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    for (let trial = 0; trial < 80; trial += 1) {
      const points = Array.from(
        { length: 1 + Math.floor(random() * 15) },
        () => ({
          x: random() * geometry.width,
          y: random() * geometry.height,
        }),
      );
      if (trial % 2 === 0) points.push(points[0]!);
      const radius = 0.1 + random() * 20;
      const mask = createBrushMask(
        points,
        radius,
        geometry.width,
        geometry.height,
      );
      if (!mask.ok) throw new Error(mask.error.message);
      for (const component of geometry.components) {
        const blockWidth = 16 / component.horizontalSampling;
        const blockHeight = 16 / component.verticalSampling;
        const columns = Math.ceil(geometry.width / blockWidth);
        const rows = Math.ceil(geometry.height / blockHeight);
        const expected = new Uint8Array(columns * rows);
        for (let by = 0; by < rows; by += 1) {
          for (let bx = 0; bx < columns; bx += 1) {
            const left = bx * blockWidth;
            const top = by * blockHeight;
            const right = Math.min(geometry.width, left + blockWidth);
            const bottom = Math.min(geometry.height, top + blockHeight);
            let count = 0;
            for (let sy = 0; sy < 8; sy += 1) {
              for (let sx = 0; sx < 8; sx += 1) {
                const x = left + ((sx + 0.5) * (right - left)) / 8;
                const y = top + ((sy + 0.5) * (bottom - top)) / 8;
                if (
                  points.some(
                    (point) =>
                      (point.x - x) ** 2 + (point.y - y) ** 2 <= radius ** 2,
                  )
                )
                  count += 1;
              }
            }
            if (count >= 32) expected[by * columns + bx] = 1;
          }
        }
        expect(
          getMaskBlockCoverageAtLeastHalf(mask.value, geometry, component.id),
        ).toEqual({
          ok: true,
          value: expected,
        });
      }
    }
  });

  it("handles long, repeated brush strokes without rejecting a pessimistic work estimate", () => {
    const geometry: JpegBlockGeometry = {
      width: 2048,
      height: 256,
      components: [
        {
          id: 1,
          horizontalSampling: 1,
          verticalSampling: 1,
          quantizationTable: 0,
        },
      ],
    };
    const points = Array.from({ length: 4000 }, (_, index) => ({
      x: 16 + (index % 250) * 8,
      y: 128,
    }));
    const mask = createBrushMask(points, 16, geometry.width, geometry.height);
    if (!mask.ok) throw new Error(mask.error.message);
    const result = getMaskBlockCoverageAtLeastHalf(mask.value, geometry, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(
      500,
    );
  });
});
