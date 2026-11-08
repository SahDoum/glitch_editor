import {
  isCoefficientRecipeStep,
  type CoefficientRecipeStep,
} from "./experiment-recipes";
import { failure, success, type Result } from "../shared/result";

export const COEFFICIENT_EFFECT_SETTINGS_KEY =
  "jpeg-glitch-editor.coefficient-settings.v1";
const MAX_SETTINGS_SIZE = 64_000;

export type CoefficientEffectSettings = Readonly<
  Record<string, CoefficientRecipeStep>
>;

export function readCoefficientEffectSettings(
  storage: Pick<Storage, "getItem">,
): Result<CoefficientEffectSettings> {
  let raw: string | null;
  try {
    raw = storage.getItem(COEFFICIENT_EFFECT_SETTINGS_KEY);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "Coefficient effect settings could not be read.",
    });
  }
  if (raw === null) return success({});
  if (raw.length > MAX_SETTINGS_SIZE) {
    return failure({
      code: "INVALID_INPUT",
      message: "Saved coefficient settings exceed the supported size.",
    });
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Object.entries(parsed).every(
        ([id, step]) => id.length > 0 && isCoefficientRecipeStep(step),
      )
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "Saved coefficient settings are invalid.",
      });
    }
    return success(parsed as CoefficientEffectSettings);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "Saved coefficient settings could not be read.",
    });
  }
}

export function writeCoefficientEffectSettings(
  storage: Pick<Storage, "setItem">,
  settings: CoefficientEffectSettings,
): Result<undefined> {
  const serialized = JSON.stringify(settings);
  if (serialized.length > MAX_SETTINGS_SIZE) {
    return failure({
      code: "INVALID_INPUT",
      message: "Coefficient settings exceed the supported storage size.",
    });
  }
  try {
    storage.setItem(COEFFICIENT_EFFECT_SETTINGS_KEY, serialized);
    return success(undefined);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "Coefficient settings could not be saved in this browser.",
    });
  }
}
