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
