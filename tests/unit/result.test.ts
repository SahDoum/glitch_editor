import { describe, expect, it } from "vitest";
import { failure, success, type Result } from "../../src/shared/result";

describe("Result helpers", () => {
  it("creates a successful result with its value", () => {
    const result = success("ready");

    expect(result).toEqual({ ok: true, value: "ready" });
  });

  it("creates a failed result with a typed error", () => {
    const result: Result<never> = failure({
      code: "UNSUPPORTED_FORMAT",
      message: "Only JPEG images are supported.",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_FORMAT",
        message: "Only JPEG images are supported.",
      },
    });
  });
});
