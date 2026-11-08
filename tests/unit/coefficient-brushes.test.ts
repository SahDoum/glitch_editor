import { describe, expect, it } from "vitest";
import {
  BUILT_IN_COEFFICIENT_BRUSHES,
  COEFFICIENT_BRUSH_STORAGE_KEY,
  LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY,
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
  it("defines component-independent built-in brush settings", () => {
    expect(BUILT_IN_COEFFICIENT_BRUSHES).toEqual([
      {
        id: "pixelate",
        name: "Pixelate",
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
        name: "AC scale",
        step: {
          domain: "ac",
          mode: "scale",
          frequencyBand: "all",
          strength: 2,
          seed: 1,
        },
      },
      {
        id: "dc-steps",
        name: "Poster",
        step: {
          domain: "dc",
          mode: "dc-steps",
          frequencyBand: "all",
          strength: 32,
          seed: 1,
        },
      },
      {
        id: "ringing",
        name: "Ringing",
        step: {
          domain: "ac",
          mode: "ringing-boost",
          frequencyBand: "all",
          strength: 4,
          seed: 1,
        },
      },
      {
        id: "engraving",
        name: "Engraving",
        step: {
          domain: "ac",
          mode: "engrave-horizontal",
          frequencyBand: "all",
          strength: 4,
          seed: 1,
        },
      },
    ]);
  });

  it("persists and restores a custom brush without a component target", () => {
    const storage = memoryStorage();
    const brush: CoefficientBrush = {
      id: "custom",
      name: "My brush",
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
    expect(storage.getItem(COEFFICIENT_BRUSH_STORAGE_KEY)).toBe(
      JSON.stringify([brush]),
    );
    expect(
      saveCoefficientBrush(storage, [brush], {
        ...brush,
        id: "other",
        name: "my BRUSH",
      }).ok,
    ).toBe(false);
  });

  it("rejects component targets in the current brush storage schema", () => {
    const storage = memoryStorage();
    storage.setItem(
      COEFFICIENT_BRUSH_STORAGE_KEY,
      JSON.stringify([{ ...DEFAULT_USER_BRUSH, componentIndex: 1 }]),
    );

    expect(readCoefficientBrushes(storage).ok).toBe(false);
    expect(storage.getItem(COEFFICIENT_BRUSH_STORAGE_KEY)).toBe(
      JSON.stringify([{ ...DEFAULT_USER_BRUSH, componentIndex: 1 }]),
    );
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
        setItem: () => undefined,
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

  it("migrates saved v1 brushes by removing their component target", () => {
    const storage = memoryStorage();
    const legacy = {
      ...DEFAULT_USER_BRUSH,
      componentIndex: 2,
    };
    storage.setItem(
      LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY,
      JSON.stringify([legacy]),
    );

    expect(readCoefficientBrushes(storage)).toEqual({
      ok: true,
      value: [DEFAULT_USER_BRUSH],
    });
    expect(storage.getItem(COEFFICIENT_BRUSH_STORAGE_KEY)).toBe(
      JSON.stringify([DEFAULT_USER_BRUSH]),
    );
    expect(storage.getItem(LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY)).toBe(
      JSON.stringify([legacy]),
    );
  });

  it("reports a failed v1 migration without discarding legacy brushes", () => {
    const legacy = {
      ...DEFAULT_USER_BRUSH,
      componentIndex: 2,
    };
    const storage = {
      getItem: (key: string) =>
        key === LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY
          ? JSON.stringify([legacy])
          : null,
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readCoefficientBrushes(storage)).toMatchObject({
      ok: false,
      error: { code: "PROCESSING_FAILED" },
    });
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
