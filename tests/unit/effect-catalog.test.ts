import { describe, expect, it } from "vitest";
import { EFFECT_CATALOG } from "../../src/ui/effect-catalog";

describe("effect catalog", () => {
  it("keeps Pixelate and frequency-selectable Zero as separate effects", () => {
    const pixelate = EFFECT_CATALOG.find(({ id }) => id === "pixelate");
    const zero = EFFECT_CATALOG.find(({ id }) => id === "zero");

    expect(pixelate?.label).toBe("Pixelate");
    expect(pixelate?.description).toContain("all AC coefficients");
    expect(zero?.label).toBe("Zero");
    expect(zero?.description).toContain("choose DC or an AC frequency zone");
  });

  it("only lists effects backed by supported application modes", () => {
    expect(EFFECT_CATALOG.map(({ id }) => id)).toEqual([
      "pixelate",
      "posterization",
      "ringing",
      "engraving",
      "coefficient-randomize",
      "ac-scale",
      "zero",
      "dc-offset",
      "ac-low-pass",
      "ac-invert",
      "ac-isolate",
      "block-transfer",
      "block-repeat",
      "block-shuffle",
      "local-shift",
      "quantization",
      "scan-corrupt",
    ]);
    expect(
      EFFECT_CATALOG.filter(
        ({ applicationMode }) => applicationMode === "selection",
      ).map(({ id }) => id),
    ).toEqual([
      "pixelate",
      "posterization",
      "ringing",
      "engraving",
      "coefficient-randomize",
      "ac-scale",
      "zero",
      "dc-offset",
      "ac-low-pass",
      "ac-invert",
      "ac-isolate",
      "block-shuffle",
      "local-shift",
    ]);
    expect(
      EFFECT_CATALOG.filter(
        ({ applicationMode }) => applicationMode === "gesture",
      ).map(({ id }) => id),
    ).toEqual(["block-transfer", "block-repeat"]);
  });
});
