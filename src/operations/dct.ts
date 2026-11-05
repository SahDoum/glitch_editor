import { failure, success, type Result } from "../shared/result";

export const DCT_FREQUENCY_BANDS = ["low", "mid", "high", "all"] as const;
export type DctFrequencyBand = (typeof DCT_FREQUENCY_BANDS)[number];
export const MAX_DCT_OPERATIONS = 256;

export interface DctBandRange {
  readonly minimum: number;
  readonly maximum: number;
}

export const DCT_FREQUENCY_BAND_RANGES: Readonly<
  Record<DctFrequencyBand, DctBandRange>
> = Object.freeze({
  low: Object.freeze({ minimum: 1, maximum: 2 }),
  mid: Object.freeze({ minimum: 3, maximum: 5 }),
  high: Object.freeze({ minimum: 6, maximum: 14 }),
  all: Object.freeze({ minimum: 1, maximum: 14 }),
});

export function getDctFrequencyBand(value: unknown): Result<DctFrequencyBand> {
  if (typeof value !== "string") {
    return failure({
      code: "INVALID_INPUT",
      message: "The DCT frequency band is invalid.",
    });
  }
  const frequencyBand = DCT_FREQUENCY_BANDS.find((band) => band === value);
  if (!frequencyBand) {
    return failure({
      code: "INVALID_INPUT",
      message: "The DCT frequency band is invalid.",
    });
  }
  return success(frequencyBand);
}
