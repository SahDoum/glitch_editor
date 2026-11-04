import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../fixtures/manifest.json";
import { inspectJpeg } from "../../src/jpeg/inspect";

async function fixtureBytes(fileName: string): Promise<Uint8Array> {
  const buffer = await readFile(
    new URL(`../fixtures/${fileName}`, import.meta.url),
  );
  return new Uint8Array(buffer);
}

function insertBytes(
  source: Uint8Array,
  offset: number,
  inserted: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(source.length + inserted.length);
  result.set(source.subarray(0, offset));
  result.set(inserted, offset);
  result.set(source.subarray(offset), offset + inserted.length);
  return result;
}

describe("JPEG inspector", () => {
  it("inspects baseline color JPEG metadata and marker boundaries", async () => {
    const fixture = manifest.fixtures.find(
      ({ file }) => file === "synthetic-color-420.jpg",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const bytes = await fixtureBytes(fixture.file);
    const result = inspectJpeg(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      process: "Baseline sequential DCT Huffman",
      width: fixture.width,
      height: fixture.height,
      precision: fixture.precision,
      restartInterval: fixture.restartInterval,
      mcuWidth: 16,
      mcuHeight: 16,
      mcuColumns: 1,
      mcuRows: 1,
      components: [
        {
          id: 1,
          horizontalSampling: 2,
          verticalSampling: 2,
          quantizationTable: 0,
          dcHuffmanTable: 0,
          acHuffmanTable: 0,
          blockColumns: 2,
          blockRows: 2,
        },
        {
          id: 2,
          horizontalSampling: 1,
          verticalSampling: 1,
          quantizationTable: 1,
          dcHuffmanTable: 1,
          acHuffmanTable: 1,
          blockColumns: 1,
          blockRows: 1,
        },
        {
          id: 3,
          horizontalSampling: 1,
          verticalSampling: 1,
          quantizationTable: 1,
          dcHuffmanTable: 1,
          acHuffmanTable: 1,
          blockColumns: 1,
          blockRows: 1,
        },
      ],
    });
    expect(result.value.process.toLowerCase()).toBe(
      fixture.process.toLowerCase(),
    );
    expect(result.value.components).toHaveLength(fixture.components);
    expect(
      result.value.components.map(
        ({ horizontalSampling, verticalSampling }) =>
          `${horizontalSampling}x${verticalSampling}`,
      ),
    ).toEqual(fixture.samplingFactors);
    expect(result.value.markers[0]?.name).toBe("SOI");
    expect(result.value.markers.at(-1)?.name).toBe("EOI");
    expect(result.value.markers.map((marker) => marker.name)).toContain("SOS");
    expect(result.value.scans).toHaveLength(fixture.scanCount);
    expect(result.value.scans[0]?.dataStartOffset).toBeGreaterThan(
      result.value.markers.find((marker) => marker.name === "SOS")!.startOffset,
    );
    for (const marker of result.value.markers) {
      expect(marker.startOffset).toBeLessThan(marker.endOffset);
      expect(marker.endOffset).toBeLessThanOrEqual(bytes.byteLength);
    }
  });

  it("inspects grayscale JPEG geometry", async () => {
    const result = inspectJpeg(await fixtureBytes("synthetic-grayscale.jpg"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      width: 8,
      height: 8,
      mcuWidth: 8,
      mcuHeight: 8,
      mcuColumns: 1,
      mcuRows: 1,
      components: [
        {
          id: 1,
          horizontalSampling: 1,
          verticalSampling: 1,
          dcHuffmanTable: 0,
          acHuffmanTable: 0,
          blockColumns: 1,
          blockRows: 1,
        },
      ],
    });
  });

  it("computes padded MCU geometry for odd image dimensions", async () => {
    const bytes = await fixtureBytes("synthetic-color-420.jpg");
    const frameMarker = inspectJpeg(bytes);
    expect(frameMarker.ok).toBe(true);
    if (!frameMarker.ok) return;

    const frameStart = frameMarker.value.markers.find(
      (marker) => marker.name === "SOF0",
    )!.startOffset;
    bytes[frameStart + 5] = 0;
    bytes[frameStart + 6] = 9;
    bytes[frameStart + 7] = 0;
    bytes[frameStart + 8] = 17;

    const result = inspectJpeg(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      width: 17,
      height: 9,
      mcuColumns: 2,
      mcuRows: 1,
      components: [
        { blockColumns: 4, blockRows: 2 },
        { blockColumns: 2, blockRows: 1 },
        { blockColumns: 2, blockRows: 1 },
      ],
    });
  });

  it("rejects dimensions that exceed the documented pixel limit", async () => {
    const bytes = await fixtureBytes("synthetic-color-420.jpg");
    const frame = inspectJpeg(bytes);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;

    const frameStart = frame.value.markers.find(
      (marker) => marker.name === "SOF0",
    )!.startOffset;
    bytes[frameStart + 5] = 0xff;
    bytes[frameStart + 6] = 0xff;
    bytes[frameStart + 7] = 0xff;
    bytes[frameStart + 8] = 0xff;

    expect(inspectJpeg(bytes)).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });
  });

  it("keeps stuffed bytes inside the entropy-coded scan", async () => {
    const bytes = await fixtureBytes("synthetic-grayscale.jpg");
    const before = inspectJpeg(bytes);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const endMarker = before.value.markers.at(-1)!;
    const withStuffedByte = insertBytes(
      bytes,
      endMarker.startOffset,
      Uint8Array.of(0xff, 0x00),
    );
    const result = inspectJpeg(withStuffedByte);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scans[0]?.dataEndOffset).toBe(
      before.value.scans[0]!.dataEndOffset + 2,
    );
    expect(result.value.markers.map((marker) => marker.name)).not.toContain(
      "FF00",
    );
  });

  it("records restart markers and restart interval boundaries", async () => {
    const bytes = await fixtureBytes("synthetic-grayscale.jpg");
    const before = inspectJpeg(bytes);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const scanStart = before.value.markers.find(
      (marker) => marker.name === "SOS",
    )!.startOffset;
    const withRestartInterval = insertBytes(
      bytes,
      scanStart,
      Uint8Array.of(0xff, 0xdd, 0x00, 0x04, 0x00, 0x01),
    );
    const withRestartMarker = inspectJpeg(
      insertBytes(
        withRestartInterval,
        withRestartInterval.length - 2,
        Uint8Array.of(0xff, 0xd0),
      ),
    );

    expect(withRestartMarker.ok).toBe(true);
    if (!withRestartMarker.ok) return;
    expect(withRestartMarker.value.restartInterval).toBe(1);
    expect(
      withRestartMarker.value.markers.map((marker) => marker.name),
    ).toContain("RST0");
  });

  it("rejects restart markers without an interval or in the wrong order", async () => {
    const bytes = await fixtureBytes("synthetic-grayscale.jpg");
    const parsed = inspectJpeg(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const scanStart = parsed.value.markers.find(
      (marker) => marker.name === "SOS",
    )!.startOffset;
    const endMarker = parsed.value.markers.at(-1)!;
    const withoutInterval = insertBytes(
      bytes,
      endMarker.startOffset,
      Uint8Array.of(0xff, 0xd0),
    );
    expect(inspectJpeg(withoutInterval)).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });

    const withRestartInterval = insertBytes(
      bytes,
      scanStart,
      Uint8Array.of(0xff, 0xdd, 0x00, 0x04, 0x00, 0x01),
    );
    const outOfOrder = inspectJpeg(
      insertBytes(
        withRestartInterval,
        withRestartInterval.length - 2,
        Uint8Array.of(0xff, 0xd1),
      ),
    );
    expect(outOfOrder).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });
  });

  it("bounds marker accumulation for adversarial marker sequences", async () => {
    const bytes = await fixtureBytes("synthetic-grayscale.jpg");
    const parsed = inspectJpeg(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const scanStart = parsed.value.markers.find(
      (marker) => marker.name === "SOS",
    )!.startOffset;
    const commentSegments = new Uint8Array(10_001 * 4);
    for (let offset = 0; offset < commentSegments.length; offset += 4) {
      commentSegments.set([0xff, 0xfe, 0x00, 0x02], offset);
    }

    expect(
      inspectJpeg(insertBytes(bytes, scanStart, commentSegments)),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });
  });

  it("rejects a truncated scan as malformed without modifying source bytes", async () => {
    const source = await fixtureBytes("synthetic-color-420.jpg");
    const original = source.slice();
    const result = inspectJpeg(source.subarray(0, source.length - 2));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });
    expect(source).toEqual(original);
  });

  it("reports progressive JPEGs as unsupported", async () => {
    const bytes = await fixtureBytes("synthetic-color-420.jpg");
    const frame = inspectJpeg(bytes);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;

    const frameStart = frame.value.markers.find(
      (marker) => marker.name === "SOF0",
    )!.startOffset;
    bytes[frameStart + 1] = 0xc2;

    expect(inspectJpeg(bytes)).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });
  });

  it("rejects invalid segment lengths and missing table references", async () => {
    const fixture = manifest.fixtures.find(
      ({ file }) => file === "synthetic-color-420.jpg",
    );
    expect(fixture).toBeDefined();
    const bytes = await fixtureBytes(fixture!.file);
    const parsed = inspectJpeg(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const invalidLength = bytes.slice();
    const frameStart = parsed.value.markers.find(
      (marker) => marker.name === "SOF0",
    )!.startOffset;
    invalidLength[frameStart + 2] = 0;
    invalidLength[frameStart + 3] = 1;
    expect(inspectJpeg(invalidLength)).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });

    const missingQuantizationTable = bytes.slice();
    const dqtStart = parsed.value.markers.find(
      (marker) => marker.name === "DQT",
    )!.startOffset;
    missingQuantizationTable[dqtStart + 4] = 1;
    expect(inspectJpeg(missingQuantizationTable)).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });

    const invalidMcuSampling = bytes.slice();
    invalidMcuSampling[frameStart + 11] = 0x44;
    expect(inspectJpeg(invalidMcuSampling)).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });

    const grayscale = await fixtureBytes("synthetic-grayscale.jpg");
    const grayscaleMetadata = inspectJpeg(grayscale);
    expect(grayscaleMetadata.ok).toBe(true);
    if (!grayscaleMetadata.ok) return;
    const huffmanTableStart = grayscaleMetadata.value.markers.find(
      (marker) => marker.name === "DHT",
    )!.startOffset;
    grayscale[huffmanTableStart + 5] = 0xff;
    expect(inspectJpeg(grayscale)).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });
  });
});
