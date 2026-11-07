import { failure, success, type Result } from "./result";

export type SeededRandom = () => number;

export function createRandomSeed(previousSeed?: number): number {
  const seed = Math.floor(Math.random() * 0x1_0000_0000);
  return seed === previousSeed ? (seed + 1) >>> 0 : seed;
}

export function createSeededRandom(seed: number): Result<SeededRandom> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    return failure({
      code: "INVALID_INPUT",
      message: "A random seed must be an unsigned 32-bit integer.",
    });
  }

  let state = seed >>> 0;
  return success(() => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  });
}
