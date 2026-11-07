import { describe, expect, it } from "vitest";
import { getCoefficientRangeOptions } from "../../src/ui/tool-controls";

function getValues(mode: Parameters<typeof getCoefficientRangeOptions>[0]) {
  return getCoefficientRangeOptions(mode).map((option) => option.value);
}

const acRanges = ["ac:low", "ac:mid", "ac:high", "ac:all"];

describe("coefficient range choices", () => {
  it.each(["zero", "scale", "randomize"] as const)(
    "offers DC and all AC ranges for %s",
    (mode) => {
      expect(getValues(mode)).toEqual(["dc", ...acRanges]);
    },
  );

  it("offers only AC ranges for inversion", () => {
    expect(getValues("invert")).toEqual(acRanges);
  });

  it("excludes AC All for band isolation", () => {
    expect(getValues("isolate")).toEqual(acRanges.slice(0, 3));
  });

  it("has no range choices for DC offset", () => {
    expect(getValues("offset")).toEqual([]);
  });
});
