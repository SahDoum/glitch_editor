export type JpegOutputMode = "baseline" | "progressive";

export interface EncodeOptions {
  mode: JpegOutputMode;
}

export const DEFAULT_ENCODE_OPTIONS: EncodeOptions = { mode: "baseline" };

export function isJpegOutputMode(value: unknown): value is JpegOutputMode {
  return value === "baseline" || value === "progressive";
}
