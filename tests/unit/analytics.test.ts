import { afterEach, describe, expect, it, vi } from "vitest";
import { startAnalytics } from "../../src/analytics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Tag Manager", () => {
  it("does not load or send anything without a container ID", () => {
    const appendChild = vi.fn();
    vi.stubGlobal("document", { head: { appendChild } });
    startAnalytics(undefined);
    expect(appendChild).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs without loading a third-party script", () => {
    const appendChild = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("document", { head: { appendChild } });
    startAnalytics("not-an-id");
    expect(appendChild).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("loads the container and preserves the existing data layer", () => {
    const script = {};
    const appendChild = vi.fn();
    const fakeWindow = {
      dataLayer: [{ existing: true }],
    };
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => script),
      head: { appendChild },
    });
    startAnalytics("GTM-K6BK97GW");
    expect(fakeWindow.dataLayer).toEqual([
      { existing: true },
      { "gtm.start": expect.any(Number), event: "gtm.js" },
    ]);
    expect(script).toMatchObject({
      async: true,
      src: "https://www.googletagmanager.com/gtm.js?id=GTM-K6BK97GW",
    });
    expect(appendChild).toHaveBeenCalledWith(script);
  });
});
