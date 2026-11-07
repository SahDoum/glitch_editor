import { describe, expect, it } from "vitest";
import {
  getComponentChoiceOptions,
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
      "Y — Brightness / contours",
      "Cb — Blue–yellow color information",
      "Cr — Red–green color information",
    ]);
  });

  it("keeps the existing one-based YCbCr frame convention", () => {
    expect(labels(getComponentChoiceOptions(components([1, 2, 3])))).toEqual([
      "Y — Brightness / contours",
      "Cb — Blue–yellow color information",
      "Cr — Red–green color information",
    ]);
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
});
