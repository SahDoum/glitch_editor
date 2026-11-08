import { describe, expect, it } from "vitest";
import {
  getJpegComponentLabels,
  getQuantizationTableLabel,
  identifyJpegColorModel,
} from "../../src/jpeg/color-model";
import type { JpegInspection, JpegMarker } from "../../src/jpeg/inspect";

function makeSegment(code: number, payload: readonly number[]) {
  const segmentLength = payload.length + 2;
  const bytes = Uint8Array.from([
    0xff,
    code,
    segmentLength >> 8,
    segmentLength & 0xff,
    ...payload,
  ]);
  const marker: JpegMarker = {
    name: code === 0xe0 ? "APP0" : "APP14",
    code,
    startOffset: 0,
    endOffset: bytes.length,
    segmentLength,
    kind: "segment",
  };
  return { bytes, marker };
}

function inspection(markers: JpegMarker[] = []): JpegInspection {
  return {
    process: "Baseline sequential DCT Huffman",
    width: 16,
    height: 16,
    precision: 8,
    components: [1, 2, 3].map((id, index) => ({
      id,
      horizontalSampling: index === 0 ? 2 : 1,
      verticalSampling: index === 0 ? 2 : 1,
      quantizationTable: index === 0 ? 0 : 1,
      dcHuffmanTable: 0,
      acHuffmanTable: 0,
      blockColumns: 1,
      blockRows: 1,
    })),
    quantizationTables: [],
    markers,
    scans: [],
    restartInterval: 0,
    mcuWidth: 16,
    mcuHeight: 16,
    mcuColumns: 1,
    mcuRows: 1,
    blockGridComponentId: 1,
    blockWidth: 8,
    blockHeight: 8,
  };
}

describe("JPEG color-model interpretation", () => {
  it("recognizes YCbCr from JFIF metadata and labels component roles", () => {
    const jfif = makeSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
    const model = identifyJpegColorModel(jfif.bytes, inspection([jfif.marker]));
    const labels = getJpegComponentLabels(model, 3);

    expect(model.kind).toBe("ycbcr");
    expect(labels.map(({ label }) => label)).toEqual([
      "Luminance (Y)",
      "Blue chroma (Cb)",
      "Red chroma (Cr)",
    ]);
    expect(labels[1]?.tone).toBe("blue-yellow");
    expect(labels[2]?.tone).toBe("red-green");
  });

  it("recognizes RGB from Adobe APP14 metadata", () => {
    const adobe = makeSegment(
      0xee,
      [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0],
    );
    const model = identifyJpegColorModel(
      adobe.bytes,
      inspection([adobe.marker]),
    );
    expect(model.kind).toBe("rgb");
    expect(getJpegComponentLabels(model, 3).map(({ label }) => label)).toEqual([
      "Red",
      "Green",
      "Blue",
    ]);
    expect(model.description).toContain("RGB");
  });

  it("uses explicitly assumed YCbCr roles when a three-component frame has no marker", () => {
    const model = identifyJpegColorModel(new Uint8Array(), inspection());
    expect(model.kind).toBe("assumed-ycbcr");
    expect(model.description).toContain("assumed");
    expect(getJpegComponentLabels(model, 3)[1]?.tone).toBe("blue-yellow");
  });

  it("does not infer YCbCr roles when metadata conflicts", () => {
    const jfif = makeSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
    const adobe = makeSegment(
      0xee,
      [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0],
    );
    const markers = [
      jfif.marker,
      {
        ...adobe.marker,
        startOffset: jfif.bytes.length,
        endOffset: jfif.bytes.length + adobe.bytes.length,
      },
    ];
    const bytes = new Uint8Array(jfif.bytes.length + adobe.bytes.length);
    bytes.set(jfif.bytes);
    bytes.set(adobe.bytes, jfif.bytes.length);

    const model = identifyJpegColorModel(bytes, inspection(markers));
    expect(model.kind).toBe("unknown");
    expect(getJpegComponentLabels(model, 3)[0]?.label).toBe("Component 1");
    expect(model.description).toContain("conflict");
  });

  it("restores DQT labels from component table assignments", () => {
    const model = identifyJpegColorModel(
      new Uint8Array(),
      inspection([makeSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]).marker]),
    );
    const labels = getJpegComponentLabels(model, 3);
    expect(getQuantizationTableLabel(0, inspection().components, labels)).toBe(
      "DQT 0 · Luminance (Y)",
    );
    expect(getQuantizationTableLabel(1, inspection().components, labels)).toBe(
      "DQT 1 · Blue chroma (Cb) / Red chroma (Cr)",
    );
  });
});
