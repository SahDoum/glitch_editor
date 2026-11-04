import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mapJpegBlockCoordinate } from "../../src/jpeg/block-geometry";
import { inspectJpeg } from "../../src/jpeg/inspect";

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
});
