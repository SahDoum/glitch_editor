import { describe, expect, it } from "vitest";
import {
  getComponentChoiceOptions,
  type ChoiceOption,
} from "../../src/ui/tool-controls";
import type { JpegComponent } from "../../src/jpeg/inspect";
import type { JpegComponentLabel } from "../../src/jpeg/color-model";

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
  it("does not infer color semantics from zero-based component IDs", () => {
    expect(labels(getComponentChoiceOptions(components([0, 1, 2])))).toEqual([
      "Component 1",
      "Component 2",
      "Component 3",
    ]);
  });

  it("does not infer color semantics from one-based component IDs", () => {
    expect(labels(getComponentChoiceOptions(components([1, 2, 3])))).toEqual([
      "Component 1",
      "Component 2",
      "Component 3",
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

  it("applies detected labels and component tones without inferring them from IDs", () => {
    const detectedLabels: JpegComponentLabel[] = [
      { label: "Luminance (Y)" },
      { label: "Blue chroma (Cb)", tone: "blue-yellow" },
      { label: "Red chroma (Cr)", tone: "red-green" },
    ];
    expect(
      getComponentChoiceOptions(components([4, 5, 6]), detectedLabels).map(
        ({ label, tone }) => ({ label, tone }),
      ),
    ).toEqual([
      { label: "Luminance (Y)", tone: undefined },
      { label: "Blue chroma (Cb)", tone: "blue-yellow" },
      { label: "Red chroma (Cr)", tone: "red-green" },
    ]);
  });
});
