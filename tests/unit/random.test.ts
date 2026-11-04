import { describe, expect, it } from "vitest";
import { createSeededRandom } from "../../src/shared/random";

describe("seeded random utility", () => {
  it("produces the same sequence for the same 32-bit seed", () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const firstSequence = Array.from({ length: 10 }, () => first.value());
    const secondSequence = Array.from({ length: 10 }, () => second.value());
    expect(firstSequence).toEqual(secondSequence);
    expect(firstSequence.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it.each([-1, 1.5, 0x1_0000_0000])("rejects invalid seed %s", (seed) => {
    expect(createSeededRandom(seed)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});
