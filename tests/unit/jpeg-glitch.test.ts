import { describe, expect, it } from "vitest";
import {
  createQuantizationPattern,
  isBlockPermutationParameters,
  isBlockRepeatParameters,
  isBlockShiftParameters,
  isBlockTransferParameters,
  isCoefficientGlitchParameters,
  MAX_BLOCK_TRANSFER_BLOCKS,
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
  it.each(["engrave-horizontal", "engrave-vertical"])(
    "validates %s direction and gain",
    (mode) => {
      const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
      if (!selection.ok || !selection.value) throw new Error("selection");
      const mask = createSpatialMask(selection.value, 16, 16);
      if (!mask.ok) throw new Error(mask.error.message);
      const operation = {
        kind: "coefficients",
        mask: mask.value,
        componentIndex: 0,
        domain: "ac",
        mode,
        frequencyBand: "all",
        strength: 4,
        seed: 1,
      };
      for (const strength of [1, 1.5, 8])
        expect(
          isCoefficientGlitchParameters({ ...operation, strength }, inspection),
        ).toBe(true);
      for (const strength of [0, 8.1, NaN, Infinity])
        expect(
          isCoefficientGlitchParameters({ ...operation, strength }, inspection),
        ).toBe(false);
      expect(
        isCoefficientGlitchParameters(
          { ...operation, domain: "dc" },
          inspection,
        ),
      ).toBe(false);
      expect(
        isCoefficientGlitchParameters(
          { ...operation, frequencyBand: "low" },
          inspection,
        ),
      ).toBe(false);
    },
  );
  it("validates ringing boost and its fixed AC band", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    if (!selection.ok || !selection.value) throw new Error("selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const operation = {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "ringing-boost",
      frequencyBand: "all",
      strength: 4,
      seed: 1,
    };
    for (const strength of [1, 2.5, 8]) {
      expect(
        isCoefficientGlitchParameters({ ...operation, strength }, inspection),
      ).toBe(true);
    }
    for (const strength of [0, 8.1, NaN, Infinity]) {
      expect(
        isCoefficientGlitchParameters({ ...operation, strength }, inspection),
      ).toBe(false);
    }
    expect(
      isCoefficientGlitchParameters({ ...operation, domain: "dc" }, inspection),
    ).toBe(false);
    expect(
      isCoefficientGlitchParameters(
        { ...operation, frequencyBand: "low" },
        inspection,
      ),
    ).toBe(false);
  });
  it("accepts only whole AC low-pass cutoffs from 1 to 14", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    if (!selection.ok || !selection.value) throw new Error("selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const operation = {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "low-pass",
      frequencyBand: "all",
      strength: 4,
      seed: 1,
    };
    for (const strength of [1, 4, 14]) {
      expect(
        isCoefficientGlitchParameters({ ...operation, strength }, inspection),
      ).toBe(true);
    }
    for (const strength of [0, 15, 2.5, -1]) {
      expect(
        isCoefficientGlitchParameters({ ...operation, strength }, inspection),
      ).toBe(false);
    }
    expect(
      isCoefficientGlitchParameters({ ...operation, domain: "dc" }, inspection),
    ).toBe(false);
    expect(
      isCoefficientGlitchParameters(
        { ...operation, frequencyBand: "low" },
        inspection,
      ),
    ).toBe(false);
  });
  it("accepts only whole DC steps from 1 to 512", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    if (!selection.ok || !selection.value) throw new Error("selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const operation = {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "dc",
      mode: "dc-steps",
      frequencyBand: "all",
      strength: 32,
      seed: 1,
    };
    expect(isCoefficientGlitchParameters(operation, inspection)).toBe(true);
    for (const strength of [0, 513, 1.5, -1]) {
      expect(
        isCoefficientGlitchParameters({ ...operation, strength }, inspection),
      ).toBe(false);
    }
    expect(
      isCoefficientGlitchParameters({ ...operation, domain: "ac" }, inspection),
    ).toBe(false);
    expect(
      isCoefficientGlitchParameters(
        { ...operation, frequencyBand: "low" },
        inspection,
      ),
    ).toBe(false);
  });
  it("validates masked block shift offsets and component", () => {
    const selection = createRectangleSelection(0, 0, 8, 8, 16, 16);
    if (!selection.ok || !selection.value) throw new Error("selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error(mask.error.message);
    const operation = {
      kind: "block-shift",
      componentIndex: 1,
      mask: mask.value,
      offsetX: 1,
      offsetY: 0,
    };
    expect(isBlockShiftParameters(operation, inspection)).toBe(true);
    expect(
      isBlockShiftParameters({ ...operation, offsetX: 0 }, inspection),
    ).toBe(false);
    expect(
      isBlockShiftParameters({ ...operation, offsetX: 257 }, inspection),
    ).toBe(false);
    expect(
      isBlockShiftParameters({ ...operation, offsetX: 1.5 }, inspection),
    ).toBe(false);
    expect(
      isBlockShiftParameters({ ...operation, componentIndex: 3 }, inspection),
    ).toBe(false);
  });
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

  it("validates the full dragged repeat path, not only its first destination", () => {
    const operation = {
      kind: "block-repeat",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      offsetX: 1,
      offsetY: 0,
      repetitions: 1,
    };
    expect(isBlockRepeatParameters(operation, inspection)).toBe(true);
    expect(
      isBlockRepeatParameters({ ...operation, repetitions: 2 }, inspection),
    ).toBe(false);
    expect(
      isBlockRepeatParameters(
        { ...operation, offsetX: 0, offsetY: 0 },
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

  it("validates equal-sized block transfers and component bounds", () => {
    const operation = {
      kind: "block-transfer",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      width: 1,
      height: 1,
      destinationX: 1,
      destinationY: 0,
      mode: "all",
      action: "copy",
    };
    expect(isBlockTransferParameters(operation, inspection)).toBe(true);
    expect(
      isBlockTransferParameters({ ...operation, destinationX: 2 }, inspection),
    ).toBe(false);
    expect(
      isBlockTransferParameters(
        { ...operation, componentIndex: 1, sourceX: 1, destinationX: 0 },
        inspection,
      ),
    ).toBe(false);
    expect(
      isBlockTransferParameters(
        { ...operation, width: MAX_BLOCK_TRANSFER_BLOCKS + 1 },
        inspection,
      ),
    ).toBe(false);
  });

  it("rejects ambiguous overlapping swaps while allowing no-op swaps", () => {
    const largerInspection = {
      ...inspection,
      width: 32,
      height: 32,
    } as JpegInspection;
    const operation = {
      kind: "block-transfer",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      width: 2,
      height: 2,
      destinationX: 1,
      destinationY: 1,
      mode: "dc",
      action: "swap",
    };

    expect(isBlockTransferParameters(operation, largerInspection)).toBe(false);
    expect(
      isBlockTransferParameters(
        { ...operation, destinationX: 0, destinationY: 0 },
        largerInspection,
      ),
    ).toBe(true);
    expect(
      isBlockTransferParameters(
        { ...operation, mode: "ac", action: "copy" },
        largerInspection,
      ),
    ).toBe(true);
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
