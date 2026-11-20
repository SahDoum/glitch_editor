import { describe, expect, it, vi } from "vitest";
import { openCoefficientInput } from "../../src/jpeg/codec-input";
import { validateCodecExports } from "../../src/jpeg/codec-loader";

describe("coefficient input ownership", () => {
  it("frees the temporary input immediately after the bridge copies it", () => {
    const heap = new Uint8Array(128);
    let copied: Uint8Array | undefined;
    const free = vi.fn();
    const status = openCoefficientInput(
      {
        HEAPU8: heap,
        _malloc: () => 32,
        _free: free,
        _coefficient_open(pointer, size) {
          expect(free).not.toHaveBeenCalled();
          copied = heap.slice(pointer, pointer + size);
          return 0;
        },
      },
      Uint8Array.of(1, 2, 3).buffer,
    );
    expect(status).toBe(0);
    expect(copied).toEqual(Uint8Array.of(1, 2, 3));
    expect(free).toHaveBeenCalledExactlyOnceWith(32);
  });

  it("frees input on failed or throwing open, and handles allocation failure", () => {
    const free = vi.fn();
    const codec = {
      HEAPU8: new Uint8Array(64),
      _malloc: () => 16,
      _free: free,
      _coefficient_open: () => -1,
    };
    expect(openCoefficientInput(codec, new ArrayBuffer(8))).toBe(-1);
    expect(free).toHaveBeenCalledExactlyOnceWith(16);
    codec._coefficient_open = () => {
      throw new Error("bridge");
    };
    expect(() => openCoefficientInput(codec, new ArrayBuffer(8))).toThrow(
      "bridge",
    );
    expect(free).toHaveBeenCalledTimes(2);
    codec._malloc = () => 0;
    expect(openCoefficientInput(codec, new ArrayBuffer(8))).toBe(-9);
    expect(free).toHaveBeenCalledTimes(2);
  });
});

it("checks heap and required ABI functions at the codec loading boundary", () => {
  expect(() => validateCodecExports(null, ["_open"])).toThrow();
  expect(() =>
    validateCodecExports({ HEAPU8: new Uint8Array(8) }, ["_open"]),
  ).toThrow();
  expect(() =>
    validateCodecExports({ HEAPU8: new Uint8Array(8), _open: () => 0 }, [
      "_open",
    ]),
  ).not.toThrow();
});
