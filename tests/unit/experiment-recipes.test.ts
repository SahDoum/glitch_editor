import { describe, expect, it } from "vitest";
import {
  BUILT_IN_EXPERIMENT_RECIPES,
  isExperimentRecipe,
  readUserRecipes,
  saveUserRecipe,
  USER_RECIPES_STORAGE_KEY,
  type RecipeStorage,
} from "../../src/application/experiment-recipes";

class MemoryStorage implements RecipeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("coefficient experiment recipes", () => {
  it("defines valid built-in recipes with fixed ordered operation steps", () => {
    expect(BUILT_IN_EXPERIMENT_RECIPES.every(isExperimentRecipe)).toBe(true);
    expect(
      BUILT_IN_EXPERIMENT_RECIPES[1]?.steps.map(({ mode }) => mode),
    ).toEqual(["offset", "invert"]);
  });

  it("saves and reloads a named multi-step recipe in local storage", () => {
    const storage = new MemoryStorage();
    const recipe = {
      schemaVersion: 1 as const,
      id: "recipe-1",
      name: "  Two-step test  ",
      steps: [
        {
          domain: "dc" as const,
          mode: "offset" as const,
          frequencyBand: "all" as const,
          strength: 8,
          seed: 1,
        },
        {
          domain: "ac" as const,
          mode: "invert" as const,
          frequencyBand: "all" as const,
          strength: 0,
          seed: 2,
        },
      ],
    };

    const saved = saveUserRecipe(storage, [], recipe);
    expect(saved).toMatchObject({
      ok: true,
      value: [
        {
          name: "Two-step test",
          steps: [{ mode: "offset" }, { mode: "invert" }],
        },
      ],
    });
    expect(storage.values.has(USER_RECIPES_STORAGE_KEY)).toBe(true);
    expect(readUserRecipes(storage)).toMatchObject({
      ok: true,
      value: [{ id: "recipe-1", name: "Two-step test" }],
    });
  });

  it("rejects duplicate names, invalid steps, and malformed stored recipes", () => {
    const storage = new MemoryStorage();
    const recipe = BUILT_IN_EXPERIMENT_RECIPES[0]!;
    const saved = saveUserRecipe(storage, [], {
      ...recipe,
      id: "user-1",
      name: "Custom cut",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(
      saveUserRecipe(storage, saved.value, {
        ...recipe,
        id: "user-2",
        name: " custom CUT ",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      isExperimentRecipe({
        ...recipe,
        steps: [{ ...recipe.steps[0], mode: "offset", domain: "ac" }],
      }),
    ).toBe(false);

    storage.values.set(USER_RECIPES_STORAGE_KEY, "{");
    expect(readUserRecipes(storage)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("reports local-storage failures instead of silently discarding recipes", () => {
    const storage: RecipeStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };

    expect(readUserRecipes(storage)).toMatchObject({
      ok: false,
      error: { code: "PROCESSING_FAILED" },
    });
    expect(
      saveUserRecipe(storage, [], BUILT_IN_EXPERIMENT_RECIPES[0]!),
    ).toMatchObject({ ok: false, error: { code: "PROCESSING_FAILED" } });
  });
});
