import { describe, expect, it } from "vitest";
import {
  getDctFrequencyChoice,
  isDctCoefficientTargeted,
} from "../../src/ui/dct-basis-matrix";

describe("DCT frequency selector", () => {
  it("maps coefficient coordinates to the corresponding selectable zone", () => {
    expect(getDctFrequencyChoice(0, 0)).toBe("dc");
    expect(getDctFrequencyChoice(1, 1)).toBe("low");
    expect(getDctFrequencyChoice(3, 2)).toBe("mid");
    expect(getDctFrequencyChoice(7, 7)).toBe("high");
  });

  it("maps the actual AC band ranges and special operation targets", () => {
    expect(isDctCoefficientTargeted(0, 0, { kind: "dc" })).toBe(true);
    expect(isDctCoefficientTargeted(1, 1, { kind: "band", band: "low" })).toBe(
      true,
    );
    expect(isDctCoefficientTargeted(3, 3, { kind: "band", band: "mid" })).toBe(
      false,
    );
    expect(
      isDctCoefficientTargeted(3, 3, { kind: "low-pass", cutoff: 5 }),
    ).toBe(true);
    expect(
      isDctCoefficientTargeted(0, 4, {
        kind: "engraving",
        direction: "horizontal",
      }),
    ).toBe(true);
  });
});
