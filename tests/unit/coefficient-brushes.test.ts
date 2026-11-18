import { describe, expect, it } from "vitest";
import {
  COEFFICIENT_BRUSH_STORAGE_KEY,
  LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY,
  BRUSH_AUTO_APPLY_STORAGE_KEY,
  DEFAULT_USER_BRUSH,
  readCoefficientBrushes as readStoredBrushes,
  readBrushAutoApply,
  saveCoefficientBrush as saveStoredBrush,
  updateCoefficientBrush as updateStoredBrush,
  writeBrushAutoApply,
  type CoefficientBrush,
} from "../../src/application/coefficient-brushes";
import type { CoefficientRecipeStep } from "../../src/application/experiment-recipes";
import { EFFECT_REGISTRY } from "../../src/features/effects/registry";

const LEGACY_BRUSH_NAMES: Readonly<Record<string, string>> = {
  pixelate: "Pixelate",
  zero: "Zero",
  "chroma-scale": "AC scale",
  "coefficient-randomize": "Randomize coefficients",
  "dc-offset": "DC offset",
  "dc-steps": "Poster",
  "ac-low-pass": "AC low-pass",
  ringing: "Ringing",
  engraving: "Engraving",
  "ac-invert": "Invert AC",
  "ac-isolate": "Isolate AC band",
};
const LEGACY_BRUSH_ORDER = [
  "pixelate",
  "zero",
  "ac-scale",
  "coefficient-randomize",
  "dc-offset",
  "posterization",
  "ac-low-pass",
  "ringing",
  "engraving",
  "ac-invert",
  "ac-isolate",
];
const REGISTERED_COEFFICIENT_TOOLS = EFFECT_REGISTRY.flatMap(({ view }) =>
  view.operation?.kinds.includes("coefficients")
    ? [
        {
          id: view.id,
          name: LEGACY_BRUSH_NAMES[view.id] ?? view.label,
          step: view.defaultSettings as CoefficientRecipeStep,
        },
      ]
    : [],
).sort(
  (first, second) =>
    LEGACY_BRUSH_ORDER.indexOf(first.id) -
    LEGACY_BRUSH_ORDER.indexOf(second.id),
);
const REGISTERED_BRUSH_IDS = REGISTERED_COEFFICIENT_TOOLS.map(({ id }) => id);
const REGISTERED_BRUSH_NAMES = REGISTERED_COEFFICIENT_TOOLS.map(
  ({ name }) => name,
);

function readCoefficientBrushes(
  storage: Parameters<typeof readStoredBrushes>[0],
) {
  return readStoredBrushes(
    storage,
    REGISTERED_BRUSH_IDS,
    REGISTERED_BRUSH_NAMES,
  );
}

function saveCoefficientBrush(
  storage: Parameters<typeof saveStoredBrush>[0],
  existing: readonly CoefficientBrush[],
  brush: CoefficientBrush,
) {
  return saveStoredBrush(
    storage,
    existing,
    brush,
    REGISTERED_BRUSH_IDS,
    REGISTERED_BRUSH_NAMES,
  );
}

function updateCoefficientBrush(
  storage: Parameters<typeof updateStoredBrush>[0],
  existing: readonly CoefficientBrush[],
  brush: CoefficientBrush,
) {
  return updateStoredBrush(
    storage,
    existing,
    brush,
    REGISTERED_BRUSH_IDS,
    REGISTERED_BRUSH_NAMES,
  );
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("coefficient brushes", () => {
  it("keeps Pixelate as fixed AC-all Zero while exposing Zero separately", () => {
    const pixelate = REGISTERED_COEFFICIENT_TOOLS.find(
      ({ id }) => id === "pixelate",
    );
    const zero = REGISTERED_COEFFICIENT_TOOLS.find(({ id }) => id === "zero");

    expect(pixelate?.step).toEqual({
      domain: "ac",
      mode: "zero",
      frequencyBand: "all",
      strength: 0,
      seed: 1,
    });
    expect(zero?.step).toEqual(pixelate?.step);
  });

  it("defines component-independent built-in brush settings", () => {
    expect(REGISTERED_COEFFICIENT_TOOLS).toEqual([
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
        id: "zero",
        name: "Zero",
        step: {
          domain: "ac",
          mode: "zero",
          frequencyBand: "all",
          strength: 0,
          seed: 1,
        },
      },
      {
        id: "ac-scale",
        name: "Coefficient Scale",
        step: {
          domain: "ac",
          mode: "scale",
          frequencyBand: "all",
          strength: 2,
          seed: 1,
        },
      },
      {
        id: "coefficient-randomize",
        name: "Randomize coefficients",
        step: {
          domain: "ac",
          mode: "randomize",
          frequencyBand: "all",
          strength: 32,
          seed: 1,
        },
      },
      {
        id: "dc-offset",
        name: "DC offset",
        step: {
          domain: "dc",
          mode: "offset",
          frequencyBand: "all",
          strength: 32,
          seed: 1,
        },
      },
      {
        id: "posterization",
        name: "Posterization",
        step: {
          domain: "dc",
          mode: "dc-steps",
          frequencyBand: "all",
          strength: 32,
          seed: 1,
        },
      },
      {
        id: "ac-low-pass",
        name: "AC low-pass",
        step: {
          domain: "ac",
          mode: "low-pass",
          frequencyBand: "all",
          strength: 4,
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
      {
        id: "ac-invert",
        name: "Invert AC",
        step: {
          domain: "ac",
          mode: "invert",
          frequencyBand: "all",
          strength: 0,
          seed: 1,
        },
      },
      {
        id: "ac-isolate",
        name: "Isolate AC band",
        step: {
          domain: "ac",
          mode: "isolate",
          frequencyBand: "low",
          strength: 0,
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
        { ...REGISTERED_COEFFICIENT_TOOLS[0]!, id: "custom", name: "Custom" },
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
      updateCoefficientBrush(storage, [renamed], {
        ...REGISTERED_COEFFICIENT_TOOLS[0]!,
        id: "pixelate",
        name: "Pixelate",
      }).ok,
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
