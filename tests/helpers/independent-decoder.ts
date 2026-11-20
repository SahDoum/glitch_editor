import { spawnSync } from "node:child_process";

/** An explicitly configured decoder must work; absence is reported by skipIf. */
export const independentDecoder = process.env.JPEG_INDEPENDENT_DECODER;

export function decodeIndependently(
  bytes: Uint8Array,
  args: readonly string[] = ["-pnm"],
) {
  if (!independentDecoder) {
    throw new Error(
      "Set JPEG_INDEPENDENT_DECODER to run independent JPEG checks.",
    );
  }
  const result = spawnSync(independentDecoder, [...args], {
    input: bytes,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}
