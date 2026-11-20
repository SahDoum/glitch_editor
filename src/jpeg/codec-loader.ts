import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";

type Codec = Awaited<ReturnType<typeof createLibjpegCoefficients>>;
// Bump whenever generated JS/WASM or the bridge ABI changes.
export const CODEC_VERSION = "progressive-1";

const COEFFICIENT_EXPORTS = [
  "_malloc",
  "_free",
  "_coefficient_open",
  "_coefficient_read_block",
  "_coefficient_apply",
  "_coefficient_repeat_block",
  "_coefficient_permute_blocks",
  "_coefficient_shift_blocks",
  "_coefficient_transfer_blocks",
  "_coefficient_set_quantization",
  "_coefficient_encode",
  "_coefficient_output_pointer",
  "_coefficient_output_size",
  "_coefficient_close",
] as const;
const DIAGNOSTIC_EXPORTS = [
  "_malloc",
  "_free",
  "_coefficient_decode_diagnostic",
  "_coefficient_decode_diagnostic_warning_count",
  "_coefficient_decode_diagnostic_warning_flags",
  "_coefficient_decode_diagnostic_decoded_rows",
  "_coefficient_decode_diagnostic_expected_rows",
] as const;

export function validateCodecExports(
  codec: unknown,
  required: readonly string[],
): void {
  if (
    typeof codec !== "object" ||
    codec === null ||
    !(Reflect.get(codec, "HEAPU8") instanceof Uint8Array) ||
    required.some((name) => typeof Reflect.get(codec, name) !== "function")
  ) {
    throw new Error("The generated JPEG codec is outdated or invalid.");
  }
}

let codecPromise: Promise<Codec> | null = null;
let coefficientPromise: Promise<Codec> | null = null;
let diagnosticPromise: Promise<Codec> | null = null;
function loadCodec(): Promise<Codec> {
  const assetUrl = (name: string) =>
    new URL(
      `${import.meta.env.BASE_URL}codec/${name}?v=${CODEC_VERSION}`,
      self.location.origin,
    ).href;
  codecPromise ??= import(
    /* @vite-ignore */ assetUrl("libjpeg-coefficients.js")
  ).then((module) => {
    const createCodec = (
      module as { default: typeof createLibjpegCoefficients }
    ).default;
    return createCodec({
      locateFile(path) {
        return path.endsWith(".wasm")
          ? assetUrl("libjpeg-coefficients.wasm")
          : path;
      },
    });
  });
  return codecPromise;
}

export function getCoefficientCodec(): Promise<Codec> {
  coefficientPromise ??= loadCodec().then((codec) => {
    validateCodecExports(codec, COEFFICIENT_EXPORTS);
    return codec;
  });
  return coefficientPromise;
}

export function getDiagnosticCodec(): Promise<Codec> {
  diagnosticPromise ??= loadCodec().then((codec) => {
    validateCodecExports(codec, DIAGNOSTIC_EXPORTS);
    return codec;
  });
  return diagnosticPromise;
}

export function resetCodecLoader(): void {
  codecPromise = null;
  coefficientPromise = null;
  diagnosticPromise = null;
}
