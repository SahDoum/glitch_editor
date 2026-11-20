import {
  COEFFICIENT_DOMAINS,
  COEFFICIENT_GLITCH_MODES,
  GLITCH_FREQUENCY_BANDS,
} from "../operations/jpeg-glitch";

// A single effect settings snapshot. Legacy user recipe persistence was removed.
export interface CoefficientRecipeStep {
  readonly domain: (typeof COEFFICIENT_DOMAINS)[number];
  readonly mode: (typeof COEFFICIENT_GLITCH_MODES)[number];
  readonly frequencyBand: (typeof GLITCH_FREQUENCY_BANDS)[number];
  readonly strength: number;
  readonly seed: number;
}

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
      (mode === "randomize" &&
        Number.isInteger(strength) &&
        strength >= 1 &&
        strength <= 2047) ||
      (mode === "offset" &&
        domain === "dc" &&
        Number.isInteger(strength) &&
        strength >= -2047 &&
        strength <= 2047) ||
      (mode === "dc-steps" &&
        domain === "dc" &&
        Number.isInteger(strength) &&
        strength >= 1 &&
        strength <= 512) ||
      (mode === "low-pass" &&
        domain === "ac" &&
        frequencyBand === "all" &&
        Number.isInteger(strength) &&
        strength >= 1 &&
        strength <= 14) ||
      ((mode === "ringing-boost" ||
        mode === "engrave-horizontal" ||
        mode === "engrave-vertical") &&
        domain === "ac" &&
        frequencyBand === "all" &&
        strength >= 1 &&
        strength <= 8) ||
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
