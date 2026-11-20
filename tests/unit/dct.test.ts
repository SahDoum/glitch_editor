import { describe, expect, it } from "vitest";
import { DCT_FREQUENCY_BAND_RANGES } from "../../src/operations/dct";

describe("DCT frequency bands", () => {
  it("defines explicit non-DC natural-order frequency ranges", () => {
    expect(DCT_FREQUENCY_BAND_RANGES).toEqual({
      low: { minimum: 1, maximum: 2 },
      mid: { minimum: 3, maximum: 5 },
      high: { minimum: 6, maximum: 14 },
      all: { minimum: 1, maximum: 14 },
    });
  });
});
