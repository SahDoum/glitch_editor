import { describe, expect, it } from "vitest";
import {
  getComponentChoiceOptions,
  getQuantizationTableLabel,
  type ChoiceOption,
} from "../../src/ui/tool-controls";
import type { JpegComponent } from "../../src/jpeg/inspect";

function components(ids: readonly number[]): JpegComponent[] {
  return ids.map((id) => ({
    id,
    horizontalSampling: 1,
    verticalSampling: 1,
    quantizationTable: 0,
    dcHuffmanTable: 0,
    acHuffmanTable: 0,
    blockColumns: 1,
    blockRows: 1,
  }));
}

function labels(options: readonly ChoiceOption<number>[]) {
  return options.map(({ label }) => label);
}

describe("JPEG component choice labels", () => {
  it("maps zero-based YCbCr frame IDs in frame order", () => {
    expect(labels(getComponentChoiceOptions(components([0, 1, 2])))).toEqual([
      "Y: Brightness / Contour",
      "Cb: blue-yellow",
      "Cr: red-green",
    ]);
  });

  it("keeps the existing one-based YCbCr frame convention", () => {
    expect(labels(getComponentChoiceOptions(components([1, 2, 3])))).toEqual([
      "Y: Brightness / Contour",
      "Cb: blue-yellow",
      "Cr: red-green",
    ]);
  });

  it("shows each component ID and sampling factors below its short label", () => {
    expect(
      getComponentChoiceOptions(components([1, 2, 3])).map(({ hint }) => hint),
    ).toEqual(["ID 1 · 1×1", "ID 2 · 1×1", "ID 3 · 1×1"]);
  });

  it("uses neutral names for unusual component IDs", () => {
    expect(labels(getComponentChoiceOptions(components([4, 5, 6])))).toEqual([
      "Component 1",
      "Component 2",
      "Component 3",
    ]);
  });

  it("labels single-component JPEGs as grayscale", () => {
    expect(labels(getComponentChoiceOptions(components([0])))).toEqual([
      "Gray",
    ]);
  });

  it("uses DQT roles only when the component assignments support them", () => {
    const assigned = components([0, 1, 2]);
    assigned[0]!.quantizationTable = 0;
    assigned[1]!.quantizationTable = 1;
    assigned[2]!.quantizationTable = 1;
    expect(getQuantizationTableLabel(0, assigned)).toBe(
      "DQT 0 — Brightness (Y)",
    );
    expect(getQuantizationTableLabel(1, assigned)).toBe(
      "DQT 1 — Color (Cb/Cr)",
    );

    assigned[2]!.quantizationTable = 0;
    expect(getQuantizationTableLabel(0, assigned)).toBe("DQT 0");
    assigned[0]!.quantizationTable = 2;
    expect(getQuantizationTableLabel(2, assigned)).toBe("DQT 2");
    expect(getQuantizationTableLabel(1, components([4, 5, 6]))).toBe("DQT 1");
  });
});
