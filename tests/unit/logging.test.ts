import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleLogger } from "../../src/shared/logging";

describe("consoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs only the event name and error code", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleLogger.error({
      event: "operation.failed",
      code: "PROCESSING_FAILED",
    });

    expect(output).toHaveBeenCalledTimes(1);
    expect(output).toHaveBeenCalledWith("[operation.failed] PROCESSING_FAILED");
  });
});
