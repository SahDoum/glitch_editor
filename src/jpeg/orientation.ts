import { failure, success, type Result } from "../shared/result";
import type { JpegInspection } from "./inspect";

export type JpegOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function readJpegOrientation(
  bytes: Uint8Array,
  inspection: JpegInspection,
): Result<JpegOrientation> {
  let orientation: JpegOrientation = 1;
  let foundExif = false;
  const invalid = () =>
    failure({
      code: "MALFORMED_JPEG" as const,
      message: "The JPEG EXIF orientation metadata is invalid or ambiguous.",
    });

  for (const marker of inspection.markers) {
    if (marker.code !== 0xe1 || marker.kind !== "segment") continue;
    let codeOffset = marker.startOffset + 1;
    while (codeOffset < marker.endOffset && bytes[codeOffset] === 0xff) {
      codeOffset++;
    }
    const start = codeOffset + 3;
    if (
      start + 6 > marker.endOffset ||
      bytes[start] !== 0x45 ||
      bytes[start + 1] !== 0x78 ||
      bytes[start + 2] !== 0x69 ||
      bytes[start + 3] !== 0x66 ||
      bytes[start + 4] !== 0 ||
      bytes[start + 5] !== 0
    )
      continue;
    if (foundExif) return invalid();
    foundExif = true;
    const tiff = start + 6;
    const end = marker.endOffset;
    if (end > bytes.length || tiff + 8 > end) return invalid();
    const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
    const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
    if (!little && !big) return invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(tiff + 2, little) !== 42) return invalid();
    const ifd = tiff + view.getUint32(tiff + 4, little);
    if (ifd < tiff + 8 || ifd + 2 > end) return invalid();
    const count = view.getUint16(ifd, little);
    if (ifd + 2 + count * 12 + 4 > end) return invalid();
    let foundOrientation = false;
    for (let index = 0; index < count; index++) {
      const entry = ifd + 2 + index * 12;
      if (view.getUint16(entry, little) !== 0x0112) continue;
      if (
        foundOrientation ||
        view.getUint16(entry + 2, little) !== 3 ||
        view.getUint32(entry + 4, little) !== 1
      )
        return invalid();
      const value = view.getUint16(entry + 8, little);
      if (value < 1 || value > 8) return invalid();
      orientation = value as JpegOrientation;
      foundOrientation = true;
    }
  }
  return success(orientation);
}
