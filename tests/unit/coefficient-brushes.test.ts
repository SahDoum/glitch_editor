import { describe, expect, it } from "vitest";
import {
  BUILT_IN_COEFFICIENT_BRUSHES,
  COEFFICIENT_BRUSH_STORAGE_KEY,
  BRUSH_AUTO_APPLY_STORAGE_KEY,
  DEFAULT_USER_BRUSH,
  readCoefficientBrushes,
  readBrushAutoApply,
  saveCoefficientBrush,
  updateCoefficientBrush,
  writeBrushAutoApply,
  type CoefficientBrush,
} from "../../src/application/coefficient-brushes";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("coefficient brushes", () => {
  it("defines the requested pixelate and component 2 scale settings", () => {
    expect(BUILT_IN_COEFFICIENT_BRUSHES).toEqual([
      {
        id: "pixelate",
        name: "Pixelate",
        componentIndex: 0,
        step: {
          domain: "ac",
          mode: "zero",
          frequencyBand: "all",
          strength: 0,
          seed: 1,
        },
      },
      {
        id: "chroma-scale",
        name: "Chroma scale",
        componentIndex: 2,
        step: {
          domain: "ac",
          mode: "scale",
          frequencyBand: "all",
          strength: 2,
          seed: 1,
        },
      },
    ]);
  });

  it("persists and restores a custom brush including component and seed", () => {
    const storage = memoryStorage();
    const brush: CoefficientBrush = {
      id: "custom",
      name: "My brush",
      componentIndex: 1,
      step: {
        domain: "ac",
        mode: "randomize",
        frequencyBand: "high",
        strength: 20,
        seed: 42,
      },
    };
    expect(saveCoefficientBrush(storage, [], brush)).toEqual({
      ok: true,
      value: [brush],
    });
    expect(readCoefficientBrushes(storage)).toEqual({
      ok: true,
      value: [brush],
    });
    expect(
      saveCoefficientBrush(storage, [brush], {
        ...brush,
        id: "other",
        name: "my BRUSH",
      }).ok,
    ).toBe(false);
  });

  it("rejects malformed or unavailable storage without overwriting it", () => {
    const storage = memoryStorage();
    storage.setItem(COEFFICIENT_BRUSH_STORAGE_KEY, "{bad");
    expect(readCoefficientBrushes(storage).ok).toBe(false);
    expect(storage.getItem(COEFFICIENT_BRUSH_STORAGE_KEY)).toBe("{bad");
    expect(
      readCoefficientBrushes({
        getItem: () => {
          throw new Error("blocked");
        },
      }).ok,
    ).toBe(false);
    expect(
      saveCoefficientBrush(
        {
          setItem: () => {
            throw new Error("blocked");
          },
        },
        [],
        { ...BUILT_IN_COEFFICIENT_BRUSHES[0]!, id: "custom", name: "Custom" },
      ).ok,
    ).toBe(false);
  });

  it("updates and renames a user brush without affecting existing brushes", () => {
    const storage = memoryStorage();
    const first = updateCoefficientBrush(storage, [], DEFAULT_USER_BRUSH);
    if (!first.ok) throw new Error(first.error.message);
    const renamed = {
      ...DEFAULT_USER_BRUSH,
      name: "Custom name",
      componentIndex: 2,
      step: { ...DEFAULT_USER_BRUSH.step, seed: 42 },
    };
    const changed = updateCoefficientBrush(storage, first.value, renamed);
    expect(changed).toEqual({ ok: true, value: [renamed] });
    expect(readCoefficientBrushes(storage)).toEqual(changed);
    expect(
      updateCoefficientBrush(
        storage,
        [renamed],
        BUILT_IN_COEFFICIENT_BRUSHES[0]!,
      ).ok,
    ).toBe(false);
    expect(
      updateCoefficientBrush(storage, [renamed], {
        ...renamed,
        name: "Pixelate",
      }).ok,
    ).toBe(false);
  });

  it("stores separate automatic-apply settings without overwriting invalid data", () => {
    const storage = memoryStorage();
    expect(
      writeBrushAutoApply(storage, { pixelate: true, "user-default": false })
        .ok,
    ).toBe(true);
    expect(readBrushAutoApply(storage)).toEqual({
      ok: true,
      value: { pixelate: true, "user-default": false },
    });
    storage.setItem(BRUSH_AUTO_APPLY_STORAGE_KEY, '{"pixelate":"yes"}');
    expect(readBrushAutoApply(storage).ok).toBe(false);
    expect(storage.getItem(BRUSH_AUTO_APPLY_STORAGE_KEY)).toBe(
      '{"pixelate":"yes"}',
    );
    expect(
      writeBrushAutoApply(
        {
          setItem: () => {
            throw new Error("blocked");
          },
        },
        { pixelate: true },
      ).ok,
    ).toBe(false);
  });
});
