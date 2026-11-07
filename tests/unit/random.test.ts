import { afterEach, describe, expect, it, vi } from "vitest";
import { createRandomSeed, createSeededRandom } from "../../src/shared/random";

describe("seeded random utility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an unsigned 32-bit seed", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(createRandomSeed()).toBe(0x8000_0000);
  });

  it("includes the full unsigned 32-bit seed range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999999);
    expect(createRandomSeed()).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("changes the seed when randomization repeats its current value", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(createRandomSeed(0x8000_0000)).toBe(0x8000_0001);
    expect(createRandomSeed(0xffff_ffff)).toBe(0x8000_0000);
  });

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
