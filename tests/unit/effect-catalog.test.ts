import { describe, expect, it } from "vitest";
import { EFFECT_CATALOG } from "../../src/ui/effect-catalog";

describe("effect catalog", () => {
  it("only lists effects backed by supported application modes", () => {
    expect(EFFECT_CATALOG.map(({ id }) => id)).toEqual([
      "pixelate",
      "ac-scale",
      "coefficient-randomize",
      "dc-offset",
      "posterization",
      "ac-low-pass",
      "ringing",
      "engraving",
      "engraving-vertical",
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
      "ac-scale",
      "coefficient-randomize",
      "dc-offset",
      "posterization",
      "ac-low-pass",
      "ringing",
      "engraving",
      "engraving-vertical",
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
