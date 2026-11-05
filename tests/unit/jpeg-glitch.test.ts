import { describe, expect, it } from "vitest";
import {
  createQuantizationPattern,
  isBlockPermutationParameters,
  isBlockRepeatParameters,
  isCoefficientGlitchParameters,
} from "../../src/operations/jpeg-glitch";
import type { JpegInspection } from "../../src/jpeg/inspect";
import {
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";

const inspection = {
  width: 16,
  height: 16,
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
    {
      id: 3,
      horizontalSampling: 1,
      verticalSampling: 1,
      quantizationTable: 1,
    },
  ],
  quantizationTables: [
    { id: 0, values: Array.from({ length: 64 }, () => 10) },
    { id: 1, values: Array.from({ length: 64 }, () => 12) },
  ],
} as JpegInspection;

describe("JPEG glitch operation validation", () => {
  it("accepts masked AC randomization with a deterministic seed", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;
    const mask = createSpatialMask(selection.value, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;

    expect(
      isCoefficientGlitchParameters(
        {
          kind: "coefficients",
          mask: mask.value,
          componentIndex: 0,
          domain: "ac",
          mode: "randomize",
          frequencyBand: "mid",
          strength: 128,
          seed: 42,
        },
        inspection,
      ),
    ).toBe(true);
    expect(
      isCoefficientGlitchParameters(
        {
          kind: "coefficients",
          mask: mask.value,
          componentIndex: 0,
          domain: "ac",
          mode: "offset",
          frequencyBand: "all",
          strength: 10,
          seed: 42,
        },
        inspection,
      ),
    ).toBe(false);
  });

  it("accepts only block repeats that remain inside the selected component grid", () => {
    expect(
      isBlockRepeatParameters(
        {
          kind: "block-repeat",
          componentIndex: 0,
          sourceX: 0,
          sourceY: 0,
          offsetX: 1,
          offsetY: 0,
          repetitions: 1,
        },
        inspection,
      ),
    ).toBe(true);
    expect(
      isBlockRepeatParameters(
        {
          kind: "block-repeat",
          componentIndex: 1,
          sourceX: 0,
          sourceY: 0,
          offsetX: 1,
          offsetY: 0,
          repetitions: 1,
        },
        inspection,
      ),
    ).toBe(false);
  });

  it("accepts AC inversion and frequency isolation only with AC parameters", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;
    const mask = createSpatialMask(selection.value, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;
    const base = {
      kind: "coefficients" as const,
      mask: mask.value,
      componentIndex: 0,
      domain: "ac" as const,
      frequencyBand: "mid" as const,
      strength: 0,
      seed: 7,
    };

    expect(
      isCoefficientGlitchParameters({ ...base, mode: "invert" }, inspection),
    ).toBe(true);
    expect(
      isCoefficientGlitchParameters(
        { ...base, mode: "isolate", frequencyBand: "low" },
        inspection,
      ),
    ).toBe(true);
    expect(
      isCoefficientGlitchParameters(
        { ...base, mode: "isolate", frequencyBand: "all" },
        inspection,
      ),
    ).toBe(false);
    expect(
      isCoefficientGlitchParameters(
        { ...base, mode: "invert", domain: "dc", frequencyBand: "all" },
        inspection,
      ),
    ).toBe(false);
  });

  it("validates component-scoped block permutation masks and seeds", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    expect(selection.ok).toBe(true);
    if (!selection.ok || !selection.value) return;
    const mask = createSpatialMask(selection.value, 16, 16);
    expect(mask.ok).toBe(true);
    if (!mask.ok) return;
    const operation = {
      kind: "block-permutation",
      componentIndex: 1,
      mask: mask.value,
      seed: 42,
    };
    expect(isBlockPermutationParameters(operation, inspection)).toBe(true);
    expect(
      isBlockPermutationParameters(
        { ...operation, componentIndex: 3 },
        inspection,
      ),
    ).toBe(false);
    expect(
      isBlockPermutationParameters({ ...operation, seed: -1 }, inspection),
    ).toBe(false);
  });
});

describe("quantization matrix patterns", () => {
  const base = Array.from({ length: 64 }, () => 16);

  it("creates bounded 8×8 patterns in natural coefficient order", () => {
    for (const pattern of [
      "flat",
      "horizontal-stripes",
      "vertical-stripes",
      "radial",
      "random",
    ] as const) {
      const generated = createQuantizationPattern(pattern, base, 99);
      expect(generated.ok).toBe(true);
      if (!generated.ok) continue;
      expect(generated.value).toHaveLength(64);
      expect(
        generated.value.every(
          (value) => Number.isInteger(value) && value >= 1 && value <= 255,
        ),
      ).toBe(true);
    }
  });

  it("repeats seeded random patterns exactly", () => {
    const first = createQuantizationPattern("random", base, 0xdecafbad);
    const second = createQuantizationPattern("random", base, 0xdecafbad);
    const otherSeed = createQuantizationPattern("random", base, 1);
    expect(first).toEqual(second);
    expect(first).not.toEqual(otherSeed);
  });

  it("rejects malformed source tables and seeds", () => {
    expect(createQuantizationPattern("flat", [0], 1)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(createQuantizationPattern("random", base, -1)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});
