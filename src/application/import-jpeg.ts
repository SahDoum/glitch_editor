import { failure, success, type Result } from "../shared/result";
import {
  type InspectWorkerRequest,
  type InspectWorkerResponse,
} from "../jpeg/inspect-worker-protocol";
import type { JpegInspection } from "../jpeg/inspect";

const MAX_JPEG_FILE_BYTES = 50 * 1024 * 1024;

export interface ImportedJpeg {
  fileName: string;
  sourceBytes: Uint8Array;
  sha256: string;
  inspection: JpegInspection;
  previewUrl: string;
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
      finish(event.data.result);
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

  const inspection = await inspectInWorker(bytes, signal);
  if (!inspection.ok) return inspection;

  let digest: ArrayBuffer;
  try {
    digest = await crypto.subtle.digest("SHA-256", sourceBuffer);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "A SHA-256 digest could not be calculated in this browser.",
    });
  }
  if (signal?.aborted) return cancelled();

  let previewUrl: string;
  try {
    previewUrl = URL.createObjectURL(file);
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
      preview.naturalWidth !== inspection.value.width ||
      preview.naturalHeight !== inspection.value.height
    ) {
      URL.revokeObjectURL(previewUrl);
      return failure({
        code: "PROCESSING_FAILED",
        message: "The browser preview dimensions do not match the JPEG frame.",
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
    fileName: file.name,
    sourceBytes: bytes,
    sha256: toHex(new Uint8Array(digest)),
    inspection: inspection.value,
    previewUrl,
  });
}
