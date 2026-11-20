import { describe, expect, it } from "vitest";
import { isCoefficientRecipeStep } from "../../src/application/experiment-recipes";

describe("coefficient experiment recipes", () => {
  it.each(["engrave-horizontal", "engrave-vertical"])(
    "validates saved %s brush settings",
    (mode) => {
      const step = {
        domain: "ac",
        mode,
        frequencyBand: "all",
        strength: 4,
        seed: 1,
      };
      expect(isCoefficientRecipeStep(step)).toBe(true);
      expect(isCoefficientRecipeStep({ ...step, strength: 0 })).toBe(false);
      expect(isCoefficientRecipeStep({ ...step, strength: 9 })).toBe(false);
      expect(isCoefficientRecipeStep({ ...step, domain: "dc" })).toBe(false);
      expect(isCoefficientRecipeStep({ ...step, frequencyBand: "low" })).toBe(
        false,
      );
    },
  );
  it("validates low-pass cutoff settings for saved brushes and recipes", () => {
    const step = {
      domain: "ac",
      mode: "low-pass",
      frequencyBand: "all",
      strength: 4,
      seed: 1,
    };
    expect(isCoefficientRecipeStep(step)).toBe(true);
    for (const strength of [0, 15, 4.5])
      expect(isCoefficientRecipeStep({ ...step, strength })).toBe(false);
    expect(isCoefficientRecipeStep({ ...step, domain: "dc" })).toBe(false);
    expect(isCoefficientRecipeStep({ ...step, frequencyBand: "mid" })).toBe(
      false,
    );
  });

  it("validates ringing boost settings for saved brushes and recipes", () => {
    const step = {
      domain: "ac",
      mode: "ringing-boost",
      frequencyBand: "all",
      strength: 4,
      seed: 1,
    };
    expect(isCoefficientRecipeStep(step)).toBe(true);
    for (const strength of [0, 8.1, NaN, Infinity])
      expect(isCoefficientRecipeStep({ ...step, strength })).toBe(false);
    expect(isCoefficientRecipeStep({ ...step, domain: "dc" })).toBe(false);
    expect(isCoefficientRecipeStep({ ...step, frequencyBand: "mid" })).toBe(
      false,
    );
  });
  it("rejects fractional Randomize settings consistently with the codec", () => {
    expect(
      isCoefficientRecipeStep({
        domain: "ac",
        mode: "randomize",
        frequencyBand: "all",
        strength: 1.5,
        seed: 1,
      }),
    ).toBe(false);
  });
});
