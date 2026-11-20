import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";

type Codec = Awaited<ReturnType<typeof createLibjpegCoefficients>>;

/** The C bridge copies input into its own storage before open returns. */
export function openCoefficientInput(
  codec: Pick<Codec, "HEAPU8" | "_malloc" | "_free" | "_coefficient_open">,
  bytes: ArrayBuffer,
): number {
  const pointer = codec._malloc(bytes.byteLength);
  if (pointer === 0) return -9;
  try {
    codec.HEAPU8.set(new Uint8Array(bytes), pointer);
    return codec._coefficient_open(pointer, bytes.byteLength);
  } finally {
    // Do not retain this second copy while applying operations or encoding.
    codec._free(pointer);
  }
}
