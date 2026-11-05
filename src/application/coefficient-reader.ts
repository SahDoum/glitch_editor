import { failure, success, type Result } from "../shared/result";
import type {
  CoefficientWorkerResponse,
  CoefficientWorkerValue,
} from "../jpeg/coefficient-worker-protocol";
import type { DctFrequencyBand } from "../operations/dct";
import type { SpatialMask } from "../document/masks";
import type { JpegBlockGeometry } from "../jpeg/block-geometry";

type CoefficientWorkerRequestPayload =
  | { type: "open"; bytes: ArrayBuffer }
  | {
      type: "read-block";
      componentIndex: number;
      blockX: number;
      blockY: number;
    };

export interface JpegCoefficientReader {
  open(bytes: Uint8Array): Promise<Result<undefined>>;
  readBlock(
    componentIndex: number,
    blockX: number,
    blockY: number,
  ): Promise<Result<number[]>>;
  close(): void;
}

export interface JpegCoefficientEdit {
  readonly componentIndex: number;
  readonly frequencyBand: DctFrequencyBand;
  readonly mask: SpatialMask;
}

export async function encodeJpegCoefficients(
  bytes: Uint8Array,
  geometry: JpegBlockGeometry,
  edits: readonly JpegCoefficientEdit[],
  signal?: AbortSignal,
): Promise<Result<Uint8Array>> {
  if (typeof Worker === "undefined") {
    return failure({
      code: "PROCESSING_FAILED",
      message: "This browser does not support background JPEG re-encoding.",
    });
  }

  if (signal?.aborted) {
    return failure({
      code: "CANCELLED",
      message: "JPEG re-encoding was cancelled.",
    });
  }

  let worker: Worker;
  try {
    worker = new Worker(
      new URL("../jpeg/coefficient.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The JPEG re-encoding worker could not be started.",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<Uint8Array>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(result);
    };
    const onAbort = () =>
      finish(
        failure({
          code: "CANCELLED",
          message: "JPEG re-encoding was cancelled.",
        }),
      );

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<CoefficientWorkerResponse>) => {
      const { result } = event.data;
      if (!result.ok) {
        finish(result);
        return;
      }
      if (
        result.value.type !== "encoded" ||
        !(result.value.bytes instanceof ArrayBuffer) ||
        result.value.bytes.byteLength === 0
      ) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The JPEG encoder returned an invalid response.",
          }),
        );
        return;
      }
      finish(success(new Uint8Array(result.value.bytes)));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "JPEG re-encoding stopped unexpectedly.",
        }),
      );
    };
    worker.onmessageerror = () =>
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "The JPEG encoder returned an unreadable response.",
        }),
      );

    let inputBuffer: ArrayBuffer;
    try {
      inputBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(inputBuffer).set(bytes);
      worker.postMessage(
        {
          type: "encode",
          id: 0,
          bytes: inputBuffer,
          geometry,
          edits,
        },
        [inputBuffer],
      );
    } catch {
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "JPEG data could not be sent to the re-encoding worker.",
        }),
      );
    }
  });
}

interface PendingRequest {
  resolve(result: Result<CoefficientWorkerValue>): void;
}

class WorkerJpegCoefficientReader implements JpegCoefficientReader {
  private readonly worker: Worker;
  private nextRequestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private openRequest: Promise<Result<undefined>> | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<CoefficientWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      pending.resolve(event.data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.failPending({
        code: "PROCESSING_FAILED",
        message: "The WebAssembly coefficient reader stopped unexpectedly.",
      });
    };
    worker.onmessageerror = () => {
      this.failPending({
        code: "PROCESSING_FAILED",
        message: "The coefficient reader returned an unreadable response.",
      });
    };
  }

  async open(bytes: Uint8Array): Promise<Result<undefined>> {
    if (this.openRequest) return this.openRequest;
    const copy = bytes.slice();
    const buffer = new ArrayBuffer(copy.byteLength);
    new Uint8Array(buffer).set(copy);
    const request = this.send({
      type: "open",
      bytes: buffer,
    }).then((result) => {
      if (!result.ok) {
        this.openRequest = null;
        return result;
      }
      if (result.value.type !== "opened") {
        this.openRequest = null;
        return failure({
          code: "PROCESSING_FAILED",
          message: "The coefficient reader returned an invalid response.",
        });
      }
      return success(undefined);
    });
    this.openRequest = request;
    return request;
  }

  async readBlock(
    componentIndex: number,
    blockX: number,
    blockY: number,
  ): Promise<Result<number[]>> {
    const result = await this.send({
      type: "read-block",
      componentIndex,
      blockX,
      blockY,
    });
    if (!result.ok) return result;
    if (
      result.value.type !== "block" ||
      result.value.values.length !== 64 ||
      !result.value.values.every(Number.isInteger)
    ) {
      return failure({
        code: "PROCESSING_FAILED",
        message: "The coefficient reader returned an invalid DCT block.",
      });
    }
    return { ok: true, value: result.value.values };
  }

  close(): void {
    this.worker.terminate();
    this.failPending({
      code: "CANCELLED",
      message: "JPEG coefficient inspection was cancelled.",
    });
  }

  private send(
    request: CoefficientWorkerRequestPayload,
  ): Promise<Result<CoefficientWorkerValue>> {
    const id = this.nextRequestId++;
    const message =
      request.type === "open"
        ? { type: "open" as const, id, bytes: request.bytes }
        : {
            type: "read-block" as const,
            id,
            componentIndex: request.componentIndex,
            blockX: request.blockX,
            blockY: request.blockY,
          };
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      try {
        if (message.type === "open") {
          this.worker.postMessage(message, [message.bytes]);
        } else {
          this.worker.postMessage(message);
        }
      } catch {
        this.pending.delete(id);
        resolve(
          failure({
            code: "PROCESSING_FAILED",
            message: "JPEG data could not be sent to the coefficient reader.",
          }),
        );
      }
    });
  }

  private failPending(error: {
    code: "CANCELLED" | "PROCESSING_FAILED";
    message: string;
  }) {
    for (const { resolve } of this.pending.values()) {
      resolve(failure(error));
    }
    this.pending.clear();
  }
}

export function createJpegCoefficientReader(): Result<JpegCoefficientReader> {
  if (typeof Worker === "undefined") {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "This browser does not support background JPEG coefficient inspection.",
    });
  }

  try {
    const worker = new Worker(
      new URL("../jpeg/coefficient.worker.ts", import.meta.url),
      { type: "module" },
    );
    return {
      ok: true,
      value: new WorkerJpegCoefficientReader(worker),
    };
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The JPEG coefficient reader could not be started.",
    });
  }
}
