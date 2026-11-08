import {
  isCoefficientRecipeStep,
  type CoefficientRecipeStep,
} from "./experiment-recipes";
import { failure, success, type Result } from "../shared/result";

export interface CoefficientBrush {
  readonly id: string;
  readonly name: string;
  readonly step: CoefficientRecipeStep;
}

export const BUILT_IN_COEFFICIENT_BRUSHES: readonly CoefficientBrush[] = [
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
    name: "DC steps",
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
];

export const COEFFICIENT_BRUSH_STORAGE_KEY = "jpeg-glitch-editor.brushes.v2";
export const LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY =
  "jpeg-glitch-editor.brushes.v1";
export const BRUSH_AUTO_APPLY_STORAGE_KEY = "jpeg-glitch-editor.brush-auto.v1";
export const DEFAULT_USER_BRUSH: CoefficientBrush = {
  id: "user-default",
  name: "User brush",
  step: {
    domain: "ac",
    mode: "zero",
    frequencyBand: "all",
    strength: 0,
    seed: 1,
  },
};
const MAX_BRUSHES = 50;
const MAX_STORAGE_SIZE = 256_000;

function isCoefficientBrush(value: unknown): value is CoefficientBrush {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  if ("componentIndex" in value) return false;
  const { id, name, step } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= 48 &&
    isCoefficientRecipeStep(step)
  );
}

type LegacyCoefficientBrush = CoefficientBrush & {
  readonly componentIndex: number;
};

function isLegacyCoefficientBrush(
  value: unknown,
): value is LegacyCoefficientBrush {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const { id, name, componentIndex, step } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= 48 &&
    typeof componentIndex === "number" &&
    Number.isSafeInteger(componentIndex) &&
    componentIndex >= 0 &&
    componentIndex < 256 &&
    isCoefficientRecipeStep(step)
  );
}

function parseBrushes(serialized: string): Result<unknown[]> {
  if (serialized.length > MAX_STORAGE_SIZE)
    return failure({
      code: "INVALID_INPUT",
      message: "Saved brushes exceed the supported storage size.",
    });
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "Saved brushes contain invalid JSON.",
    });
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_BRUSHES)
    return failure({
      code: "INVALID_INPUT",
      message: "Saved brushes do not match the supported schema.",
    });
  return success(parsed);
}

function validateBrushIds(brushes: readonly CoefficientBrush[]): Result<void> {
  const ids = [...BUILT_IN_COEFFICIENT_BRUSHES, ...brushes].map(
    (brush) => brush.id,
  );
  return new Set(ids).size === ids.length
    ? success(undefined)
    : failure({
        code: "INVALID_INPUT",
        message: "Saved brushes contain duplicate identifiers.",
      });
}

export function readCoefficientBrushes(
  storage: Pick<Storage, "getItem" | "setItem">,
): Result<readonly CoefficientBrush[]> {
  let serialized: string | null;
  let isLegacy = false;
  try {
    serialized = storage.getItem(COEFFICIENT_BRUSH_STORAGE_KEY);
    if (serialized === null) {
      serialized = storage.getItem(LEGACY_COEFFICIENT_BRUSH_STORAGE_KEY);
      isLegacy = serialized !== null;
    }
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "Saved brushes could not be read from local storage.",
    });
  }
  if (serialized === null) return success([]);
  const parsed = parseBrushes(serialized);
  if (!parsed.ok) return parsed;
  if (isLegacy) {
    if (!parsed.value.every(isLegacyCoefficientBrush))
      return failure({
        code: "INVALID_INPUT",
        message: "Saved brushes do not match the supported schema.",
      });
    const migrated = parsed.value.map(({ id, name, step }) => ({
      id,
      name,
      step,
    }));
    const ids = validateBrushIds(migrated);
    if (!ids.ok) return ids;
    try {
      storage.setItem(COEFFICIENT_BRUSH_STORAGE_KEY, JSON.stringify(migrated));
    } catch {
      return failure({
        code: "PROCESSING_FAILED",
        message: "Saved brushes could not be migrated to the current format.",
      });
    }
    return success(migrated);
  }
  if (!parsed.value.every(isCoefficientBrush))
    return failure({
      code: "INVALID_INPUT",
      message: "Saved brushes do not match the supported schema.",
    });
  const ids = validateBrushIds(parsed.value);
  return ids.ok ? success(parsed.value) : ids;
}

export function saveCoefficientBrush(
  storage: Pick<Storage, "setItem">,
  existing: readonly CoefficientBrush[],
  brush: CoefficientBrush,
): Result<readonly CoefficientBrush[]> {
  if (!isCoefficientBrush(brush))
    return failure({
      code: "INVALID_INPUT",
      message: "The brush settings are invalid.",
    });
  const all = [...BUILT_IN_COEFFICIENT_BRUSHES, ...existing];
  if (
    existing.length >= MAX_BRUSHES ||
    all.some(
      (item) =>
        item.id === brush.id ||
        item.name.trim().toLowerCase() === brush.name.trim().toLowerCase(),
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The brush limit was reached or this brush name already exists.",
    });
  }
  const next = [...existing, brush];
  const serialized = JSON.stringify(next);
  if (serialized.length > MAX_STORAGE_SIZE)
    return failure({
      code: "INVALID_INPUT",
      message: "Saved brushes exceed the supported storage size.",
    });
  try {
    storage.setItem(COEFFICIENT_BRUSH_STORAGE_KEY, serialized);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The brush could not be saved to local storage.",
    });
  }
  return success(next);
}

export function updateCoefficientBrush(
  storage: Pick<Storage, "setItem">,
  existing: readonly CoefficientBrush[],
  brush: CoefficientBrush,
): Result<readonly CoefficientBrush[]> {
  if (
    !isCoefficientBrush(brush) ||
    BUILT_IN_COEFFICIENT_BRUSHES.some((item) => item.id === brush.id)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The brush settings are invalid or cannot be edited.",
    });
  }
  const index = existing.findIndex((item) => item.id === brush.id);
  if (index < 0) return saveCoefficientBrush(storage, existing, brush);
  if (
    [...BUILT_IN_COEFFICIENT_BRUSHES, ...existing].some(
      (item) =>
        item.id !== brush.id &&
        item.name.trim().toLowerCase() === brush.name.trim().toLowerCase(),
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "A brush already uses this name.",
    });
  }
  const next = existing.map((item) => (item.id === brush.id ? brush : item));
  const serialized = JSON.stringify(next);
  if (serialized.length > MAX_STORAGE_SIZE)
    return failure({
      code: "INVALID_INPUT",
      message: "Saved brushes exceed the supported storage size.",
    });
  try {
    storage.setItem(COEFFICIENT_BRUSH_STORAGE_KEY, serialized);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The brush could not be saved to local storage.",
    });
  }
  return success(next);
}

export function readBrushAutoApply(
  storage: Pick<Storage, "getItem">,
): Result<Readonly<Record<string, boolean>>> {
  let serialized: string | null;
  try {
    serialized = storage.getItem(BRUSH_AUTO_APPLY_STORAGE_KEY);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "Brush automatic-apply settings could not be read.",
    });
  }
  if (serialized === null) return success({});
  if (serialized.length > MAX_STORAGE_SIZE)
    return failure({
      code: "INVALID_INPUT",
      message: "Brush automatic-apply settings are too large.",
    });
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "Brush automatic-apply settings contain invalid JSON.",
    });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([key, enabled]) =>
        key.length === 0 || key.length > 128 || typeof enabled !== "boolean",
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "Brush automatic-apply settings are invalid.",
    });
  }
  return success(value as Record<string, boolean>);
}

export function writeBrushAutoApply(
  storage: Pick<Storage, "setItem">,
  settings: Readonly<Record<string, boolean>>,
): Result<undefined> {
  const serialized = JSON.stringify(settings);
  if (serialized.length > MAX_STORAGE_SIZE)
    return failure({
      code: "INVALID_INPUT",
      message: "Brush automatic-apply settings are too large.",
    });
  try {
    storage.setItem(BRUSH_AUTO_APPLY_STORAGE_KEY, serialized);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "Brush automatic-apply settings could not be saved.",
    });
  }
  return success(undefined);
}
