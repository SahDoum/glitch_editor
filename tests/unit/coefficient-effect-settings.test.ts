import { describe, expect, it } from "vitest";
import {
  COEFFICIENT_EFFECT_SETTINGS_KEY,
  readCoefficientEffectSettings,
  writeCoefficientEffectSettings,
} from "../../src/application/coefficient-effect-settings";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("coefficient effect settings persistence", () => {
  it("round-trips validated settings separately from project operation data", () => {
    const storage = createStorage();
    const settings = {
      pixelate: {
        domain: "ac" as const,
        mode: "zero" as const,
        frequencyBand: "high" as const,
        strength: 0,
        seed: 7,
      },
    };

    expect(writeCoefficientEffectSettings(storage, settings)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(readCoefficientEffectSettings(storage)).toEqual({
      ok: true,
      value: settings,
    });
    expect(
      COEFFICIENT_EFFECT_SETTINGS_KEY.startsWith(
        "jpeg-glitch-editor.coefficient-settings",
      ),
    ).toBe(true);
  });

  it("rejects malformed or oversized stored data", () => {
    expect(
      readCoefficientEffectSettings(
        createStorage({
          [COEFFICIENT_EFFECT_SETTINGS_KEY]: '{"bad":{"seed":-1}}',
        }),
      ).ok,
    ).toBe(false);
    expect(
      readCoefficientEffectSettings(
        createStorage({
          [COEFFICIENT_EFFECT_SETTINGS_KEY]: "x".repeat(64_001),
        }),
      ).ok,
    ).toBe(false);
  });

  it.each(["engrave-horizontal", "engrave-vertical"] as const)(
    "persists the selected engraving direction %s with the effect settings",
    (mode) => {
      const storage = createStorage();
      const settings = {
        engraving: {
          domain: "ac" as const,
          mode,
          frequencyBand: "all" as const,
          strength: 5,
          seed: 1,
        },
      };

      expect(writeCoefficientEffectSettings(storage, settings).ok).toBe(true);
      expect(readCoefficientEffectSettings(storage)).toEqual({
        ok: true,
        value: settings,
      });
    },
  );
});
