import { isWorkerResult } from "./worker-response";
import { failure, success, type AppError, type Result } from "../shared/result";
import {
  isJpegBlockGeometry,
  isOperationList,
} from "../jpeg/codec-controllers/registry";
import type {
  CoefficientWorkerResponse,
  CoefficientWorkerValue,
} from "../jpeg/coefficient-worker-protocol";
import type { JpegGlitchOperation } from "../operations/jpeg-glitch";
import type { JpegBlockGeometry } from "../jpeg/block-geometry";
import {
  DEFAULT_ENCODE_OPTIONS,
  type EncodeOptions,
} from "../jpeg/encode-options";

type CoefficientWorkerRequestPayload =
  | { type: "open"; bytes: ArrayBuffer }
  | {
      type: "read-block";
      componentIndex: number;
      blockX: number;
      blockY: number;
    };

export interface JpegCoefficientReader {
  open(): Promise<Result<undefined>>;
  readBlock(
    componentIndex: number,
    blockX: number,
    blockY: number,
  ): Promise<Result<number[]>>;
  close(): void;
}

export async function encodeJpegCoefficients(
  bytes: Uint8Array,
  geometry: JpegBlockGeometry,
  operations: readonly JpegGlitchOperation[],
  signal?: AbortSignal,
  options: EncodeOptions = DEFAULT_ENCODE_OPTIONS,
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

  if (
    !isJpegBlockGeometry(geometry) ||
    !isOperationList(operations, geometry)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message:
        "The JPEG operations or geometry are invalid or exceed the processing limit.",
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
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
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
      const result: unknown =
        typeof event.data === "object" && event.data !== null
          ? Reflect.get(event.data, "result")
          : undefined;
      if (!isWorkerResult(result, isCoefficientValue) || event.data.id !== 0) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The JPEG encoder returned an invalid response.",
          }),
        );
        return;
      }
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
          operations,
          options,
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
  private terminalError: AppError | null = null;
  private source: Uint8Array | null;

  constructor(worker: Worker, bytes: Uint8Array) {
    this.source = bytes;
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        !Number.isInteger(Reflect.get(data, "id"))
      ) {
        this.failPending({
          code: "PROCESSING_FAILED",
          message: "The coefficient reader returned an invalid response.",
        });
        return;
      }
      const id: number = Reflect.get(data, "id");
      const pending = this.pending.get(id);
      if (!pending) return;
      const result: unknown = Reflect.get(data, "result");
      if (!isWorkerResult(result, isCoefficientValue)) {
        this.failPending({
          code: "PROCESSING_FAILED",
          message: "The coefficient reader returned an invalid response.",
        });
        return;
      }
      this.pending.delete(id);
      pending.resolve(result);
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

  async open(): Promise<Result<undefined>> {
    if (this.terminalError) return failure(this.terminalError);
    if (this.openRequest) return this.openRequest;
    const source = this.source;
    if (!source)
      return failure({
        code: "PROCESSING_FAILED",
        message: "The coefficient reader has no source.",
      });
    // This is the one owned snapshot taken when the reader was created.
    const buffer = source.buffer as ArrayBuffer;
    this.source = null;
    const request = this.send({
      type: "open",
      bytes: buffer,
    }).then((result) => {
      if (!result.ok) {
        this.failPending(result.error);
        return result;
      }
      if (result.value.type !== "opened") {
        const error: AppError = {
          code: "PROCESSING_FAILED",
          message: "The coefficient reader returned an invalid response.",
        };
        this.failPending(error);
        return failure(error);
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
    const opened = await this.open();
    if (!opened.ok) return opened;
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
      const error: AppError = {
        code: "PROCESSING_FAILED",
        message: "The coefficient reader returned an invalid DCT block.",
      };
      this.failPending(error);
      return failure(error);
    }
    return { ok: true, value: result.value.values };
  }

  close(): void {
    this.failPending({
      code: "CANCELLED",
      message: "JPEG coefficient inspection was cancelled.",
    });
  }

  private send(
    request: CoefficientWorkerRequestPayload,
  ): Promise<Result<CoefficientWorkerValue>> {
    if (this.terminalError) return Promise.resolve(failure(this.terminalError));
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
        this.failPending({
          code: "PROCESSING_FAILED",
          message: "JPEG data could not be sent to the coefficient reader.",
        });
      }
    });
  }

  private failPending(error: AppError) {
    if (this.terminalError) return;
    this.terminalError = error;
    this.source = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
    for (const { resolve } of this.pending.values()) resolve(failure(error));
    this.pending.clear();
  }
}

export function createJpegCoefficientReader(
  bytes: Uint8Array,
): Result<JpegCoefficientReader> {
  if (bytes.byteLength === 0 || bytes.byteLength > 50 * 1024 * 1024)
    return failure({
      code: "INVALID_INPUT",
      message: "The JPEG coefficient source size is invalid.",
    });
  if (typeof Worker === "undefined") {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "This browser does not support background JPEG coefficient inspection.",
    });
  }

  try {
    const source = bytes.slice();
    const worker = new Worker(
      new URL("../jpeg/coefficient.worker.ts", import.meta.url),
      { type: "module" },
    );
    return {
      ok: true,
      value: new WorkerJpegCoefficientReader(worker, source),
    };
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The JPEG coefficient reader could not be started.",
    });
  }
}

function isCoefficientValue(value: unknown): value is CoefficientWorkerValue {
  if (typeof value !== "object" || value === null) return false;
  switch (Reflect.get(value, "type")) {
    case "opened":
      return true;
    case "encoded":
      return Reflect.get(value, "bytes") instanceof ArrayBuffer;
    case "block": {
      const values: unknown = Reflect.get(value, "values");
      return (
        Array.isArray(values) &&
        values.length === 64 &&
        values.every(Number.isInteger)
      );
    }
    default:
      return false;
  }
}
