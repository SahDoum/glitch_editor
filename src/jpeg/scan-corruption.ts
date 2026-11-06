import { inspectJpeg, type JpegInspection } from "./inspect";
import { createSeededRandom } from "../shared/random";
import { failure, success, type Result } from "../shared/result";

export const MAX_SCAN_CORRUPTION_BYTES = 256;
export const MAX_SCAN_CORRUPTION_STAGES = 8;
const MAX_JPEG_BYTES = 50 * 1024 * 1024;
const MAX_SCAN_CORRUPTION_WORK_BYTES = 100 * 1024 * 1024;

export type ScanCorruptionMode = "bit-flip" | "byte-replacement";

export interface ScanCorruptionParameters {
  readonly mode: ScanCorruptionMode;
  readonly count: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly seed: number;
}

export interface ScanCorruptionReport extends ScanCorruptionParameters {
  readonly scanStartOffset: number;
  readonly scanEndOffset: number;
  readonly changedBytes: number;
  readonly changedBits: number;
}

export interface ScanCorruptionResult {
  readonly bytes: Uint8Array;
  readonly reports: readonly ScanCorruptionReport[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isScanCorruptionParameters(
  value: unknown,
): value is ScanCorruptionParameters {
  if (!isRecord(value)) return false;
  return (
    (value.mode === "bit-flip" || value.mode === "byte-replacement") &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 1 &&
    value.count <= MAX_SCAN_CORRUPTION_BYTES &&
    typeof value.rangeStart === "number" &&
    Number.isFinite(value.rangeStart) &&
    value.rangeStart >= 0 &&
    value.rangeStart < 1 &&
    typeof value.rangeEnd === "number" &&
    Number.isFinite(value.rangeEnd) &&
    value.rangeEnd > 0 &&
    value.rangeEnd <= 1 &&
    value.rangeStart < value.rangeEnd &&
    typeof value.seed === "number" &&
    Number.isInteger(value.seed) &&
    value.seed >= 0 &&
    value.seed <= 0xffff_ffff
  );
}

function scanBoundaryError(
  bytes: Uint8Array,
  inspection: JpegInspection,
): string | null {
  if (bytes.byteLength > MAX_JPEG_BYTES) {
    return "JPEG outputs larger than 50 MiB cannot be scan-corrupted.";
  }
  if (inspection.scans.length !== 1) {
    return "Scan Corrupt requires one verified baseline entropy-coded scan.";
  }
  const endMarker = inspection.markers.at(-1);
  if (
    endMarker?.name !== "EOI" ||
    endMarker.endOffset !== bytes.byteLength ||
    inspection.scans[0]?.entropyRanges.length === 0
  ) {
    return "The encoded JPEG does not have a complete, bounded scan and EOI marker.";
  }
  return null;
}

function markerSignature(inspection: JpegInspection): string {
  return inspection.markers
    .map(
      ({ code, startOffset, endOffset }) =>
        `${code}:${startOffset}:${endOffset}`,
    )
    .join("|");
}

function popcount(value: number): number {
  let bits = value;
  let count = 0;
  while (bits !== 0) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
}

function copyBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function applyStage(
  input: Uint8Array,
  parameters: ScanCorruptionParameters,
): Result<{ bytes: Uint8Array; report: ScanCorruptionReport }> {
  if (!isScanCorruptionParameters(parameters)) {
    return failure({
      code: "INVALID_INPUT",
      message: "Scan Corrupt parameters are outside their supported bounds.",
    });
  }
  if (input.byteLength === 0 || input.byteLength > MAX_JPEG_BYTES) {
    return failure({
      code: "INVALID_INPUT",
      message: "Scan Corrupt requires an encoded JPEG no larger than 50 MiB.",
    });
  }

  const inspectionResult = inspectJpeg(input);
  if (!inspectionResult.ok) return inspectionResult;
  const inspection = inspectionResult.value;
  const boundaryError = scanBoundaryError(input, inspection);
  if (boundaryError) {
    return failure({ code: "UNSUPPORTED_FORMAT", message: boundaryError });
  }

  const scan = inspection.scans[0]!;
  const scanStartOffset = scan.entropyRanges[0]!.startOffset;
  const scanEndOffset = scan.entropyRanges.at(-1)!.endOffset;
  const scanLength = scanEndOffset - scanStartOffset;
  const selectedStart =
    scanStartOffset + Math.floor(parameters.rangeStart * scanLength);
  const selectedEnd =
    scanStartOffset + Math.ceil(parameters.rangeEnd * scanLength);
  const randomResult = createSeededRandom(parameters.seed);
  if (!randomResult.ok) return randomResult;
  const random = randomResult.value;
  const selectedOffsets: number[] = [];
  let eligibleCount = 0;

  for (const range of scan.entropyRanges) {
    const start = Math.max(range.startOffset, selectedStart);
    const end = Math.min(range.endOffset, selectedEnd);
    for (let offset = start; offset < end; offset += 1) {
      const byte = input[offset]!;
      if (byte === 0xff || input[offset - 1] === 0xff) continue;

      eligibleCount += 1;
      if (selectedOffsets.length < parameters.count) {
        selectedOffsets.push(offset);
        continue;
      }

      const replacementIndex = Math.floor(random() * eligibleCount);
      if (replacementIndex < parameters.count) {
        selectedOffsets[replacementIndex] = offset;
      }
    }
  }

  if (eligibleCount < parameters.count) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The selected scan range contains fewer safe entropy bytes than the requested corruption count.",
    });
  }

  const output = copyBytes(input);
  let changedBits = 0;
  for (const offset of selectedOffsets) {
    const originalByte = output[offset]!;
    if (parameters.mode === "byte-replacement") {
      const candidate = Math.floor(random() * 254);
      const replacement = candidate >= originalByte ? candidate + 1 : candidate;
      output[offset] = replacement;
      changedBits += popcount(originalByte ^ replacement);
      continue;
    }

    const firstBit = Math.floor(random() * 8);
    let replacement = originalByte;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bit = (firstBit + attempt) % 8;
      const candidate = originalByte ^ (1 << bit);
      if (candidate !== 0xff) {
        replacement = candidate;
        changedBits += 1;
        break;
      }
    }
    if (replacement === 0xff || replacement === originalByte) {
      return failure({
        code: "PROCESSING_FAILED",
        message: "A safe entropy-byte bit flip could not be selected.",
      });
    }
    output[offset] = replacement;
  }

  const outputInspection = inspectJpeg(output);
  if (!outputInspection.ok) {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "The corrupted output failed structural validation; the clean encoded result was preserved.",
    });
  }
  if (
    output.byteLength !== input.byteLength ||
    markerSignature(outputInspection.value) !== markerSignature(inspection)
  ) {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "Scan Corrupt changed a protected JPEG boundary; the clean encoded result was preserved.",
    });
  }

  return success({
    bytes: output,
    report: {
      ...parameters,
      scanStartOffset,
      scanEndOffset,
      changedBytes: selectedOffsets.length,
      changedBits,
    },
  });
}

export function corruptEntropyScan(
  bytes: Uint8Array,
  stages: readonly ScanCorruptionParameters[],
): Result<ScanCorruptionResult> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_JPEG_BYTES ||
    !Array.isArray(stages) ||
    stages.length < 1 ||
    stages.length > MAX_SCAN_CORRUPTION_STAGES ||
    bytes.byteLength * stages.length > MAX_SCAN_CORRUPTION_WORK_BYTES
  ) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "Scan Corrupt requires one to eight bounded stages, no more than 100 MiB of total scan work, and a JPEG no larger than 50 MiB.",
    });
  }

  let current = copyBytes(bytes);
  const reports: ScanCorruptionReport[] = [];
  for (const stage of stages) {
    const result = applyStage(current, stage);
    if (!result.ok) return result;
    current = result.value.bytes;
    reports.push(result.value.report);
  }

  return success({ bytes: current, reports });
}
