import { failure, success, type Result } from "../shared/result";
import type {
  CoefficientWorkerResponse,
  CoefficientWorkerValue,
} from "../jpeg/coefficient-worker-protocol";

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
