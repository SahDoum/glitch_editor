import type { JpegBlockGeometry } from "../jpeg/block-geometry";
import type { JpegOrientation } from "../jpeg/orientation";
import type { JpegGlitchOperation } from "../operations/jpeg-glitch";
import { failure, success, type Result } from "../shared/result";
import { encodeJpegCoefficients } from "./coefficient-reader";
import type { ImportedJpeg } from "./import-jpeg";
import { EncodingPlanCache, encodingPlanKey } from "./encoding-plan";
import { previewDimensions } from "./preview-orientation";

export interface EncodedJpegFrame {
  readonly bytes: Uint8Array;
  readonly url: string | null;
  readonly displayError: string;
}

export function jpegGeometry({ inspection }: ImportedJpeg): JpegBlockGeometry {
  return {
    width: inspection.width,
    height: inspection.height,
    components: inspection.components,
  };
}

export function createJpegPreviewUrl(bytes: Uint8Array): string {
  // Blob snapshots the view synchronously; no extra staging copy is needed.
  const view =
    bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([view], { type: "image/jpeg" }));
}

export async function encodeJpegFrame(
  source: ImportedJpeg,
  orientation: JpegOrientation,
  operations: readonly JpegGlitchOperation[],
  signal: AbortSignal,
  cache?: EncodingPlanCache,
): Promise<Result<EncodedJpegFrame>> {
  const compute = (encodingSignal: AbortSignal) =>
    encodeJpegCoefficients(
      source.originalAsset.readBytes(),
      jpegGeometry(source),
      operations,
      encodingSignal,
    );
  const encoded = await (cache
    ? cache.run(source, encodingPlanKey(operations), signal, compute)
    : compute(signal));
  if (!encoded.ok) return encoded;

  const frame = await decodeJpegFrame(
    source,
    orientation,
    encoded.value,
    signal,
  );
  return frame
    ? success(frame)
    : failure({ code: "CANCELLED", message: "JPEG encoding cancelled." });
}

export async function decodeJpegFrame(
  source: ImportedJpeg,
  orientation: JpegOrientation,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<EncodedJpegFrame | null> {
  if (signal.aborted) return null;
  let url: string | null = null;
  let displayError = "";
  try {
    url = createJpegPreviewUrl(bytes);
    const preview = new Image();
    preview.src = url;
    await preview.decode();
    const expected = previewDimensions(source.inspection, orientation);
    if (
      preview.naturalWidth !== expected.width ||
      preview.naturalHeight !== expected.height
    ) {
      displayError = "The encoded JPG dimensions differ from the source.";
    }
  } catch {
    displayError = "The browser could not show the encoded JPG.";
  }
  if (url && (displayError || signal.aborted)) {
    URL.revokeObjectURL(url);
    url = null;
  }
  return signal.aborted ? null : { bytes, url, displayError };
}
