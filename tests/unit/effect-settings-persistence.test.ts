import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COEFFICIENT_EFFECT_SETTINGS_KEY } from "../../src/application/coefficient-effect-settings";
import { getEffect, getStorageKey } from "../../src/features/effects/registry";
import {
  persistEffectSettings,
  readPersistedEffectSettings,
} from "../../src/features/effects/settings-persistence";

function createStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("effect settings persistence", () => {
  let storage: ReturnType<typeof createStorage>;
  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps legacy storage keys for renamed effects", () => {
    const posterization = getEffect("posterization")?.view;
    const scale = getEffect("ac-scale")?.view;
    if (!posterization || !scale) throw new Error("views");
    expect(getStorageKey(posterization)).toBe("dc-steps");
    expect(getStorageKey(scale)).toBe("chroma-scale");
  });

  it("round-trips settings through the existing storage format", () => {
    const view = getEffect("posterization")?.view;
    if (!view) throw new Error("view");
    const step = {
      domain: "dc",
      frequencyBand: "all",
      mode: "dc-steps",
      strength: 16,
      seed: 3,
    };
    const written = persistEffectSettings(view, { posterization: step });
    expect(written.ok).toBe(true);
    expect(
      JSON.parse(storage.getItem(COEFFICIENT_EFFECT_SETTINGS_KEY) ?? ""),
    ).toEqual({
      "dc-steps": step,
    });
    const read = readPersistedEffectSettings();
    expect(read.error).toBe("");
    expect(read.settings.posterization).toEqual(step);
  });

  it("reports invalid stored data without throwing", () => {
    storage.setItem(COEFFICIENT_EFFECT_SETTINGS_KEY, "{not json");
    const read = readPersistedEffectSettings();
    expect(read.error).not.toBe("");
    expect(read.settings).toEqual({});
  });
});
