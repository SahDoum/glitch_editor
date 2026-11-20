import { failure, success, type Result } from "../shared/result";
import {
  type InspectWorkerRequest,
  type InspectWorkerResponse,
} from "../jpeg/inspect-worker-protocol";
import type { JpegInspection } from "../jpeg/inspect";
import { OriginalAsset } from "../document/model";
import { isWorkerResult } from "./worker-response";
import {
  identifyJpegColorModel,
  type JpegColorModel,
} from "../jpeg/color-model";
import type { JpegOrientation } from "../jpeg/orientation";
import { previewDimensions, readJpegOrientation } from "./preview-orientation";

const MAX_JPEG_FILE_BYTES = 50 * 1024 * 1024;

export interface ImportedJpeg {
  originalAsset: OriginalAsset;
  inspection: JpegInspection;
  previewUrl: string;
  orientation: JpegOrientation;
  colorModel: JpegColorModel;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function cancelled(): Result<never> {
  return failure({
    code: "CANCELLED",
    message: "JPEG inspection was cancelled.",
  });
}

function inspectInWorker(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Result<JpegInspection>> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(
      failure({
        code: "PROCESSING_FAILED",
        message: "This browser does not support background JPEG inspection.",
      }),
    );
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("../jpeg/inspect.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return Promise.resolve(
      failure({
        code: "PROCESSING_FAILED",
        message: "A background JPEG inspector could not be started.",
      }),
    );
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<JpegInspection>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(result);
    };
    const onAbort = () => finish(cancelled());

    if (signal?.aborted) {
      finish(cancelled());
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    let buffer: ArrayBuffer;
    try {
      buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
    } catch {
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "There was not enough memory to inspect this JPEG.",
        }),
      );
      return;
    }
    worker.onmessage = (event: MessageEvent<InspectWorkerResponse>) => {
      const result: unknown =
        typeof event.data === "object" && event.data !== null
          ? Reflect.get(event.data, "result")
          : undefined;
      if (!isWorkerResult(result, isInspection)) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The JPEG inspector returned an invalid response.",
          }),
        );
        return;
      }
      finish(result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "JPEG inspection stopped unexpectedly.",
        }),
      );
    };
    worker.onmessageerror = () => {
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "The JPEG inspector returned an unreadable response.",
        }),
      );
    };

    try {
      const request: InspectWorkerRequest = { type: "inspect", bytes: buffer };
      worker.postMessage(request, [buffer]);
    } catch {
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "JPEG data could not be sent to the background inspector.",
        }),
      );
    }
  });
}

export async function importJpeg(
  file: File,
  signal?: AbortSignal,
): Promise<Result<ImportedJpeg>> {
  if (file.size > MAX_JPEG_FILE_BYTES) {
    return failure({
      code: "INVALID_INPUT",
      message: "JPEG files larger than 50 MiB are not supported.",
    });
  }
  if (signal?.aborted) return cancelled();

  let sourceBuffer: ArrayBuffer;
  try {
    sourceBuffer = await file.arrayBuffer();
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "The selected file could not be read. Please try opening it again.",
    });
  }
  if (signal?.aborted) return cancelled();
  const bytes = new Uint8Array(sourceBuffer);

  return importBytes({ bytes, fileName: file.name }, signal);
}

/** Import only a source whose digest has already been verified by the project reader.
 * Keep its digest and optional inspection paired with the exact bytes returned
 * by that reader; a verified inspection avoids starting another parser worker.
 */
export function importVerifiedProjectJpeg(
  source: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly sha256: string;
    readonly inspection?: JpegInspection;
  },
  signal?: AbortSignal,
): Promise<Result<ImportedJpeg>> {
  return importBytes(source, signal);
}

async function importBytes(
  source: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly sha256?: string;
    readonly inspection?: JpegInspection;
  },
  signal?: AbortSignal,
): Promise<Result<ImportedJpeg>> {
  const { bytes, fileName } = source;
  if (signal?.aborted) return cancelled();
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_JPEG_FILE_BYTES ||
    (source.sha256 !== undefined && !/^[\da-f]{64}$/i.test(source.sha256))
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The JPEG source metadata or size is invalid.",
    });
  }
  if (source.inspection !== undefined && !isInspection(source.inspection)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The verified JPEG inspection is invalid.",
    });
  }
  const inspection =
    source.inspection !== undefined
      ? success(source.inspection)
      : await inspectInWorker(bytes, signal);
  if (!inspection.ok) return inspection;
  if (signal?.aborted) return cancelled();
  const orientation = readJpegOrientation(bytes, inspection.value);
  if (!orientation.ok) return orientation;
  const colorModel = identifyJpegColorModel(bytes, inspection.value);
  const expectedPreview = previewDimensions(
    inspection.value,
    orientation.value,
  );

  let sha256 = source.sha256;
  if (sha256 === undefined) {
    try {
      sha256 = toHex(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            bytes as Uint8Array<ArrayBuffer>,
          ),
        ),
      );
    } catch {
      return failure({
        code: "PROCESSING_FAILED",
        message: "A SHA-256 digest could not be calculated in this browser.",
      });
    }
  }
  if (signal?.aborted) return cancelled();
  const originalAsset = OriginalAsset.create({ fileName, sha256, bytes });
  if (!originalAsset.ok) return originalAsset;

  let previewUrl: string;
  try {
    previewUrl = URL.createObjectURL(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
    );
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "A local preview could not be created for this JPEG.",
    });
  }

  let preview: HTMLImageElement;
  try {
    preview = new Image();
    preview.src = previewUrl;
  } catch {
    URL.revokeObjectURL(previewUrl);
    return failure({
      code: "PROCESSING_FAILED",
      message: "A local preview could not be created for this JPEG.",
    });
  }
  let abortPreview: (() => void) | null = null;
  try {
    const decode = preview.decode();
    if (signal) {
      await Promise.race([
        decode,
        new Promise<never>((_, reject) => {
          abortPreview = () => {
            preview.src = "";
            reject(new Error("JPEG preview was cancelled."));
          };
          signal.addEventListener("abort", abortPreview, { once: true });
          if (signal.aborted) abortPreview();
        }),
      ]);
    } else {
      await decode;
    }
    if (signal?.aborted) {
      URL.revokeObjectURL(previewUrl);
      return cancelled();
    }
    if (
      preview.naturalWidth !== expectedPreview.width ||
      preview.naturalHeight !== expectedPreview.height
    ) {
      URL.revokeObjectURL(previewUrl);
      return failure({
        code: "PROCESSING_FAILED",
        message: `The browser preview dimensions (${preview.naturalWidth} × ${preview.naturalHeight}) do not match the expected oriented JPEG dimensions (${expectedPreview.width} × ${expectedPreview.height}).`,
      });
    }
  } catch {
    URL.revokeObjectURL(previewUrl);
    if (signal?.aborted) return cancelled();
    return failure({
      code: "PROCESSING_FAILED",
      message: "This browser could not decode a preview of the JPEG.",
    });
  } finally {
    if (abortPreview) signal?.removeEventListener("abort", abortPreview);
  }

  return success({
    originalAsset: originalAsset.value,
    inspection: inspection.value,
    previewUrl,
    orientation: orientation.value,
    colorModel,
  });
}

function isInspection(value: unknown): value is JpegInspection {
  if (!isObject(value)) return false;
  const process = Reflect.get(value, "process");
  if (
    typeof process !== "string" ||
    !["Baseline sequential DCT Huffman", "Progressive DCT Huffman"].includes(
      process,
    )
  )
    return false;
  if (
    ![
      "width",
      "height",
      "precision",
      "mcuWidth",
      "mcuHeight",
      "mcuColumns",
      "mcuRows",
      "blockWidth",
      "blockHeight",
    ].every((key) => isInteger(Reflect.get(value, key), 1))
  )
    return false;
  if (
    !["restartInterval", "blockGridComponentId"].every((key) =>
      isInteger(Reflect.get(value, key)),
    )
  )
    return false;
  const components: unknown = Reflect.get(value, "components");
  const tables: unknown = Reflect.get(value, "quantizationTables");
  const markers: unknown = Reflect.get(value, "markers");
  const scans: unknown = Reflect.get(value, "scans");
  return (
    Array.isArray(components) &&
    components.length > 0 &&
    components.every(
      (component) =>
        isObject(component) &&
        [
          "id",
          "horizontalSampling",
          "verticalSampling",
          "quantizationTable",
          "dcHuffmanTable",
          "acHuffmanTable",
          "blockColumns",
          "blockRows",
        ].every((key) => isInteger(Reflect.get(component, key))),
    ) &&
    Array.isArray(tables) &&
    tables.every(
      (table) =>
        isObject(table) &&
        isInteger(Reflect.get(table, "id")) &&
        Array.isArray(table.values) &&
        table.values.length === 64 &&
        table.values.every((v: unknown) => isInteger(v, 1)),
    ) &&
    Array.isArray(markers) &&
    markers.every(
      (marker) =>
        isObject(marker) &&
        typeof marker.name === "string" &&
        typeof marker.kind === "string" &&
        ["standalone", "segment", "restart"].includes(marker.kind) &&
        ["code", "startOffset", "endOffset"].every((key) =>
          isInteger(Reflect.get(marker, key)),
        ) &&
        (marker.segmentLength === null || isInteger(marker.segmentLength)),
    ) &&
    Array.isArray(scans) &&
    scans.every(
      (scan) =>
        isObject(scan) &&
        [
          "dataStartOffset",
          "dataEndOffset",
          "endMarkerOffset",
          "spectralStart",
          "spectralEnd",
          "approximationHigh",
          "approximationLow",
        ].every((key) => isInteger(Reflect.get(scan, key))) &&
        Array.isArray(scan.entropyRanges) &&
        scan.entropyRanges.every(
          (range: unknown) =>
            isObject(range) &&
            isInteger(range.startOffset) &&
            isInteger(range.endOffset),
        ) &&
        Array.isArray(scan.components) &&
        scan.components.every(
          (component: unknown) =>
            isObject(component) &&
            ["id", "dcHuffmanTable", "acHuffmanTable"].every((key) =>
              isInteger(Reflect.get(component, key)),
            ),
        ),
    )
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, min = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}
