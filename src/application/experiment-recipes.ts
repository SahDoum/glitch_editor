import { failure, success, type Result } from "../shared/result";
import {
  COEFFICIENT_DOMAINS,
  COEFFICIENT_GLITCH_MODES,
  GLITCH_FREQUENCY_BANDS,
} from "../operations/jpeg-glitch";

export const EXPERIMENT_RECIPE_SCHEMA_VERSION = 1;
export const MAX_RECIPE_STEPS = 32;
export const MAX_USER_RECIPES = 50;
export const MAX_SERIALIZED_RECIPE_SIZE = 256_000;
export const USER_RECIPES_STORAGE_KEY = "jpeg-glitch-editor.recipes.v1";

export interface CoefficientRecipeStep {
  readonly domain: (typeof COEFFICIENT_DOMAINS)[number];
  readonly mode: (typeof COEFFICIENT_GLITCH_MODES)[number];
  readonly frequencyBand: (typeof GLITCH_FREQUENCY_BANDS)[number];
  readonly strength: number;
  readonly seed: number;
}

export interface ExperimentRecipe {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly steps: readonly CoefficientRecipeStep[];
}

export interface RecipeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BUILT_IN_EXPERIMENT_RECIPES: readonly ExperimentRecipe[] =
  Object.freeze([
    Object.freeze({
      schemaVersion: 1,
      id: "builtin-high-frequency-cut",
      name: "High-frequency cut",
      steps: Object.freeze([
        Object.freeze({
          domain: "ac",
          mode: "zero",
          frequencyBand: "high",
          strength: 0,
          seed: 1,
        }),
      ]),
    }),
    Object.freeze({
      schemaVersion: 1,
      id: "builtin-dc-drift",
      name: "DC drift + AC inversion",
      steps: Object.freeze([
        Object.freeze({
          domain: "dc",
          mode: "offset",
          frequencyBand: "all",
          strength: 7,
          seed: 1,
        }),
        Object.freeze({
          domain: "ac",
          mode: "invert",
          frequencyBand: "all",
          strength: 0,
          seed: 2,
        }),
      ]),
    }),
  ]);

export function isCoefficientRecipeStep(
  value: unknown,
): value is CoefficientRecipeStep {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const domain = Reflect.get(value, "domain");
  const mode = Reflect.get(value, "mode");
  const frequencyBand = Reflect.get(value, "frequencyBand");
  const strength = Reflect.get(value, "strength");
  const seed = Reflect.get(value, "seed");
  if (
    typeof domain !== "string" ||
    !COEFFICIENT_DOMAINS.some((candidate) => candidate === domain) ||
    typeof mode !== "string" ||
    !COEFFICIENT_GLITCH_MODES.some((candidate) => candidate === mode) ||
    typeof frequencyBand !== "string" ||
    !GLITCH_FREQUENCY_BANDS.some((candidate) => candidate === frequencyBand) ||
    typeof strength !== "number" ||
    !Number.isFinite(strength) ||
    typeof seed !== "number" ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffff_ffff
  ) {
    return false;
  }

  return (
    ((mode === "scale" && strength >= -8 && strength <= 8) ||
      (mode === "randomize" && strength >= 1 && strength <= 2047) ||
      (mode === "offset" &&
        domain === "dc" &&
        Number.isInteger(strength) &&
        strength >= -2047 &&
        strength <= 2047) ||
      ((mode === "invert" || mode === "isolate") &&
        domain === "ac" &&
        strength === 0 &&
        (mode !== "isolate" || frequencyBand !== "all")) ||
      mode === "zero") &&
    (mode !== "offset" || domain === "dc") &&
    (mode !== "invert" || domain === "ac") &&
    (mode !== "isolate" || domain === "ac") &&
    (domain !== "dc" || frequencyBand === "all")
  );
}

export function isExperimentRecipe(value: unknown): value is ExperimentRecipe {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const name = Reflect.get(value, "name");
  const steps = Reflect.get(value, "steps");
  return (
    Reflect.get(value, "schemaVersion") === EXPERIMENT_RECIPE_SCHEMA_VERSION &&
    typeof Reflect.get(value, "id") === "string" &&
    Reflect.get(value, "id").length > 0 &&
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.trim().length <= 48 &&
    Array.isArray(steps) &&
    steps.length > 0 &&
    steps.length <= MAX_RECIPE_STEPS &&
    steps.every(isCoefficientRecipeStep)
  );
}

function isRecipeArray(value: unknown): value is ExperimentRecipe[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_USER_RECIPES ||
    !value.every(isExperimentRecipe)
  ) {
    return false;
  }
  const names = value.map((recipe) => recipe.name.trim().toLowerCase());
  const ids = value.map((recipe) => recipe.id);
  return (
    new Set(names).size === names.length && new Set(ids).size === ids.length
  );
}

export function readUserRecipes(
  storage: RecipeStorage,
): Result<readonly ExperimentRecipe[]> {
  let serialized: string | null;
  try {
    serialized = storage.getItem(USER_RECIPES_STORAGE_KEY);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "Saved experiment recipes could not be read from local storage.",
    });
  }
  if (serialized === null) return success(Object.freeze([]));
  if (serialized.length > MAX_SERIALIZED_RECIPE_SIZE) {
    return failure({
      code: "INVALID_INPUT",
      message: "Saved experiment recipes exceed the supported storage size.",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "Saved experiment recipes contain invalid JSON.",
    });
  }
  if (!isRecipeArray(parsed)) {
    return failure({
      code: "INVALID_INPUT",
      message: "Saved experiment recipes do not match the supported schema.",
    });
  }
  return success(Object.freeze(parsed.map(freezeRecipe)));
}

export function saveUserRecipe(
  storage: RecipeStorage,
  existing: readonly ExperimentRecipe[],
  recipe: ExperimentRecipe,
): Result<readonly ExperimentRecipe[]> {
  if (!isExperimentRecipe(recipe)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The experiment recipe name or steps are invalid.",
    });
  }
  if (
    existing.some(
      (candidate) =>
        candidate.id === recipe.id ||
        candidate.name.trim().toLowerCase() ===
          recipe.name.trim().toLowerCase(),
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "A saved experiment recipe already uses this name.",
    });
  }
  if (existing.length >= MAX_USER_RECIPES) {
    return failure({
      code: "INVALID_INPUT",
      message: `At most ${MAX_USER_RECIPES} experiment recipes can be saved.`,
    });
  }

  const recipes = Object.freeze([...existing, freezeRecipe(recipe)]);
  try {
    storage.setItem(USER_RECIPES_STORAGE_KEY, JSON.stringify(recipes));
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The experiment recipe could not be saved in local storage.",
    });
  }
  return success(recipes);
}

function freezeRecipe(recipe: ExperimentRecipe): ExperimentRecipe {
  return Object.freeze({
    schemaVersion: 1,
    id: recipe.id,
    name: recipe.name.trim(),
    steps: Object.freeze(
      recipe.steps.map((step) => Object.freeze({ ...step })),
    ),
  });
}
