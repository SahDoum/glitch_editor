import { isSpatialMask, type SpatialMask } from "../document/masks";
import { getJpegComponentBlockGrid } from "../jpeg/block-geometry";
import type { JpegInspection } from "../jpeg/inspect";
import { createSeededRandom } from "../shared/random";
import { failure, success, type Result } from "../shared/result";

export const GLITCH_FREQUENCY_BANDS = ["low", "mid", "high", "all"] as const;
export type GlitchFrequencyBand = (typeof GLITCH_FREQUENCY_BANDS)[number];
export const COEFFICIENT_DOMAINS = ["dc", "ac"] as const;
export type CoefficientDomain = (typeof COEFFICIENT_DOMAINS)[number];
export const COEFFICIENT_GLITCH_MODES = [
  "zero",
  "scale",
  "randomize",
  "offset",
  "invert",
  "isolate",
] as const;
export type CoefficientGlitchMode = (typeof COEFFICIENT_GLITCH_MODES)[number];
export const QUANTIZATION_SEMANTICS = ["reinterpret", "requantize"] as const;
export type QuantizationSemantics = (typeof QUANTIZATION_SEMANTICS)[number];
export const QUANTIZATION_PATTERNS = [
  "flat",
  "horizontal-stripes",
  "vertical-stripes",
  "radial",
  "random",
] as const;
export type QuantizationPattern = (typeof QUANTIZATION_PATTERNS)[number];
export const MAX_GLITCH_OPERATIONS = 256;

export interface CoefficientGlitchOperation {
  readonly kind: "coefficients";
  readonly mask: SpatialMask;
  readonly componentIndex: number;
  readonly domain: CoefficientDomain;
  readonly mode: CoefficientGlitchMode;
  readonly frequencyBand: GlitchFrequencyBand;
  readonly strength: number;
  readonly seed: number;
}

export interface BlockRepeatOperation {
  readonly kind: "block-repeat";
  readonly componentIndex: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly repetitions: number;
}

export interface BlockPermutationOperation {
  readonly kind: "block-permutation";
  readonly componentIndex: number;
  readonly mask: SpatialMask;
  readonly seed: number;
}

export interface QuantizationOperation {
  readonly kind: "quantization";
  readonly tableId: number;
  readonly values: readonly number[];
  readonly semantics: QuantizationSemantics;
  readonly pattern: QuantizationPattern | "manual";
  readonly seed: number;
}

export type JpegGlitchOperation =
  | CoefficientGlitchOperation
  | BlockRepeatOperation
  | BlockPermutationOperation
  | QuantizationOperation;

export function isGlitchFrequencyBand(
  value: unknown,
): value is GlitchFrequencyBand {
  return (
    typeof value === "string" &&
    GLITCH_FREQUENCY_BANDS.some((band) => band === value)
  );
}

export function isCoefficientGlitchParameters(
  value: unknown,
  inspection: JpegInspection,
): value is CoefficientGlitchOperation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (Reflect.get(value, "kind") !== "coefficients") return false;
  const mask = Reflect.get(value, "mask");
  const componentIndex = Reflect.get(value, "componentIndex");
  const domain = Reflect.get(value, "domain");
  const mode = Reflect.get(value, "mode");
  const frequencyBand = Reflect.get(value, "frequencyBand");
  const strength = Reflect.get(value, "strength");
  return (
    isSpatialMask(mask) &&
    mask.width === inspection.width &&
    mask.height === inspection.height &&
    typeof componentIndex === "number" &&
    Number.isInteger(componentIndex) &&
    componentIndex >= 0 &&
    componentIndex < inspection.components.length &&
    typeof domain === "string" &&
    COEFFICIENT_DOMAINS.some((candidate) => candidate === domain) &&
    typeof mode === "string" &&
    COEFFICIENT_GLITCH_MODES.some((candidate) => candidate === mode) &&
    isGlitchFrequencyBand(frequencyBand) &&
    typeof strength === "number" &&
    Number.isFinite(strength) &&
    typeof Reflect.get(value, "seed") === "number" &&
    Number.isInteger(Reflect.get(value, "seed")) &&
    Reflect.get(value, "seed") >= 0 &&
    Reflect.get(value, "seed") <= 0xffff_ffff &&
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

export function isBlockRepeatParameters(
  value: unknown,
  inspection: JpegInspection,
): value is BlockRepeatOperation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (Reflect.get(value, "kind") !== "block-repeat") return false;
  const componentIndex = Reflect.get(value, "componentIndex");
  const sourceX = Reflect.get(value, "sourceX");
  const sourceY = Reflect.get(value, "sourceY");
  const offsetX = Reflect.get(value, "offsetX");
  const offsetY = Reflect.get(value, "offsetY");
  const repetitions = Reflect.get(value, "repetitions");
  if (
    typeof componentIndex !== "number" ||
    !Number.isInteger(componentIndex) ||
    componentIndex < 0 ||
    componentIndex >= inspection.components.length ||
    ![sourceX, sourceY, offsetX, offsetY, repetitions].every(
      (number) => typeof number === "number" && Number.isInteger(number),
    ) ||
    (offsetX === 0 && offsetY === 0) ||
    Math.abs(offsetX) > 256 ||
    Math.abs(offsetY) > 256 ||
    repetitions < 1 ||
    repetitions > 256
  ) {
    return false;
  }

  const component = inspection.components[componentIndex];
  if (!component) return false;
  const grid = getJpegComponentBlockGrid(inspection, component.id);
  if (
    !grid ||
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX >= grid.columns ||
    sourceY >= grid.rows
  ) {
    return false;
  }
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const targetX = sourceX + offsetX * repetition;
    const targetY = sourceY + offsetY * repetition;
    if (
      targetX < 0 ||
      targetY < 0 ||
      targetX >= grid.columns ||
      targetY >= grid.rows
    ) {
      return false;
    }
  }
  return true;
}

export function isBlockPermutationParameters(
  value: unknown,
  inspection: JpegInspection,
): value is BlockPermutationOperation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const componentIndex = Reflect.get(value, "componentIndex");
  const mask = Reflect.get(value, "mask");
  const seed = Reflect.get(value, "seed");
  return (
    Reflect.get(value, "kind") === "block-permutation" &&
    typeof componentIndex === "number" &&
    Number.isInteger(componentIndex) &&
    componentIndex >= 0 &&
    componentIndex < inspection.components.length &&
    isSpatialMask(mask) &&
    mask.width === inspection.width &&
    mask.height === inspection.height &&
    typeof seed === "number" &&
    Number.isInteger(seed) &&
    seed >= 0 &&
    seed <= 0xffff_ffff
  );
}

export function isQuantizationParameters(
  value: unknown,
  inspection: JpegInspection,
): value is QuantizationOperation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (Reflect.get(value, "kind") !== "quantization") return false;
  const tableId = Reflect.get(value, "tableId");
  const values: unknown = Reflect.get(value, "values");
  const semantics = Reflect.get(value, "semantics");
  const pattern = Reflect.get(value, "pattern");
  const seed = Reflect.get(value, "seed");
  return (
    typeof tableId === "number" &&
    Number.isInteger(tableId) &&
    inspection.quantizationTables.some((table) => table.id === tableId) &&
    Array.isArray(values) &&
    values.length === 64 &&
    values.every(
      (entry: unknown) =>
        typeof entry === "number" &&
        Number.isInteger(entry) &&
        entry >= 1 &&
        entry <= 255,
    ) &&
    typeof semantics === "string" &&
    QUANTIZATION_SEMANTICS.some((candidate) => candidate === semantics) &&
    (pattern === "manual" ||
      (typeof pattern === "string" &&
        QUANTIZATION_PATTERNS.some((candidate) => candidate === pattern))) &&
    typeof seed === "number" &&
    Number.isInteger(seed) &&
    seed >= 0 &&
    seed <= 0xffff_ffff
  );
}

export function createQuantizationPattern(
  pattern: QuantizationPattern,
  baseValues: readonly number[],
  seed: number,
): Result<readonly number[]> {
  if (
    !QUANTIZATION_PATTERNS.some((candidate) => candidate === pattern) ||
    baseValues.length !== 64 ||
    !baseValues.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 255,
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The quantization pattern or source table is invalid.",
    });
  }

  const random = createSeededRandom(seed);
  if (!random.ok) return random;
  const average = Math.max(
    1,
    Math.round(baseValues.reduce((total, value) => total + value, 0) / 64),
  );
  const values = Array.from({ length: 64 }, (_, index) => {
    const u = index % 8;
    const v = Math.floor(index / 8);
    if (pattern === "random") {
      return 1 + Math.floor(random.value() * 255);
    }
    if (pattern === "horizontal-stripes") {
      return clampQuantizationValue(average * (v % 2 === 0 ? 0.5 : 2));
    }
    if (pattern === "vertical-stripes") {
      return clampQuantizationValue(average * (u % 2 === 0 ? 0.5 : 2));
    }
    if (pattern === "radial") {
      const distance = Math.hypot(u - 3.5, v - 3.5) / Math.hypot(3.5, 3.5);
      return clampQuantizationValue(average * (0.5 + distance * 1.5));
    }
    return average;
  });
  return success(Object.freeze(values));
}

function clampQuantizationValue(value: number): number {
  return Math.max(1, Math.min(255, Math.round(value)));
}
