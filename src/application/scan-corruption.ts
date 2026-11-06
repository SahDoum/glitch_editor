import { failure, success, type Result } from "../shared/result";
import type {
  ScanDecodeDiagnostic,
  ScanCorruptionWorkerRequest,
  ScanCorruptionWorkerResponse,
} from "../jpeg/scan-corruption-worker-protocol";
import {
  isScanCorruptionParameters,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
  type ScanCorruptionReport,
} from "../jpeg/scan-corruption";

export interface CorruptedEncodedJpeg {
  readonly bytes: Uint8Array;
  readonly reports: readonly ScanCorruptionReport[];
  readonly diagnostic: ScanDecodeDiagnostic;
}

export class ScanCorruptionHistory {
  private active: ScanCorruptionParameters[] = [];
  private readonly past: ScanCorruptionParameters[][] = [];
  private readonly future: ScanCorruptionParameters[][] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get activeStages(): readonly ScanCorruptionParameters[] {
    return Object.freeze([...this.active]);
  }

  get undoTarget(): readonly ScanCorruptionParameters[] {
    return Object.freeze([...(this.past.at(-1) ?? this.active)]);
  }

  get redoTarget(): readonly ScanCorruptionParameters[] {
    return Object.freeze([...(this.future.at(-1) ?? this.active)]);
  }

  record(parameters: ScanCorruptionParameters): Result<undefined> {
    if (
      !isScanCorruptionParameters(parameters) ||
      this.active.length >= MAX_SCAN_CORRUPTION_STAGES
    ) {
      return failure({
        code: "INVALID_INPUT",
        message:
          "The Scan Corrupt stage is invalid or the eight-stage limit was reached.",
      });
    }
    this.past.push(this.active);
    this.active = [...this.active, Object.freeze({ ...parameters })];
    this.future.length = 0;
    return success(undefined);
  }

  replaceLast(parameters: ScanCorruptionParameters): Result<undefined> {
    if (!isScanCorruptionParameters(parameters) || this.active.length === 0) {
      return failure({
        code: "INVALID_INPUT",
        message: "There is no valid Scan Corrupt stage to update.",
      });
    }
    this.past.push(this.active);
    this.active = [
      ...this.active.slice(0, -1),
      Object.freeze({ ...parameters }),
    ];
    this.future.length = 0;
    return success(undefined);
  }

  commitUndo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.active);
    this.active = previous;
    return true;
  }

  commitRedo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.active);
    this.active = next;
    return true;
  }

  clear(): void {
    this.active = [];
    this.past.length = 0;
    this.future.length = 0;
  }
}

export function corruptEncodedJpeg(
  cleanEncodedBytes: Uint8Array,
  stages: readonly ScanCorruptionParameters[],
  signal?: AbortSignal,
): Promise<Result<CorruptedEncodedJpeg>> {
  if (
    cleanEncodedBytes.byteLength === 0 ||
    !Array.isArray(stages) ||
    stages.length === 0 ||
    stages.length > MAX_SCAN_CORRUPTION_STAGES ||
    !stages.every(isScanCorruptionParameters)
  ) {
    return Promise.resolve(
      failure({
        code: "INVALID_INPUT",
        message: "The clean JPEG or Scan Corrupt parameters are invalid.",
      }),
    );
  }
  if (signal?.aborted) {
    return Promise.resolve(
      failure({
        code: "CANCELLED",
        message: "Scan corruption was cancelled.",
      }),
    );
  }
  if (typeof Worker === "undefined") {
    return Promise.resolve(
      failure({
        code: "PROCESSING_FAILED",
        message: "This browser does not support background scan corruption.",
      }),
    );
  }

  let worker: Worker;
  try {
    worker = new Worker(
      new URL("../jpeg/scan-corruption.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    return Promise.resolve(
      failure({
        code: "PROCESSING_FAILED",
        message: "The Scan Corrupt worker could not be started.",
      }),
    );
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<CorruptedEncodedJpeg>) => {
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
          message: "Scan corruption was cancelled.",
        }),
      );

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ScanCorruptionWorkerResponse>) => {
      if (event.data.id !== 0) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The Scan Corrupt worker returned an unexpected response.",
          }),
        );
        return;
      }
      const { result } = event.data;
      if (!result.ok) {
        finish(result);
        return;
      }
      if (
        result.value.type !== "corrupted" ||
        !(result.value.bytes instanceof ArrayBuffer) ||
        result.value.bytes.byteLength !== cleanEncodedBytes.byteLength ||
        !Array.isArray(result.value.reports) ||
        result.value.reports.length !== stages.length ||
        typeof result.value.diagnostic !== "object" ||
        result.value.diagnostic === null ||
        result.value.diagnostic.decoder !== "libjpeg-turbo" ||
        ![
          "complete",
          "warnings",
          "incomplete",
          "failed",
          "unavailable",
        ].includes(result.value.diagnostic.status) ||
        !Number.isSafeInteger(result.value.diagnostic.decodedRows) ||
        !Number.isSafeInteger(result.value.diagnostic.expectedRows) ||
        !Number.isSafeInteger(result.value.diagnostic.warningCount) ||
        !Number.isSafeInteger(result.value.diagnostic.warningFlags) ||
        typeof result.value.diagnostic.message !== "string"
      ) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The Scan Corrupt worker returned an invalid response.",
          }),
        );
        return;
      }
      finish(
        success({
          bytes: new Uint8Array(result.value.bytes),
          reports: result.value.reports,
          diagnostic: result.value.diagnostic,
        }),
      );
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "Scan corruption stopped unexpectedly.",
        }),
      );
    };
    worker.onmessageerror = () =>
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "The Scan Corrupt worker returned an unreadable response.",
        }),
      );

    let inputBuffer: ArrayBuffer;
    try {
      inputBuffer = new ArrayBuffer(cleanEncodedBytes.byteLength);
      new Uint8Array(inputBuffer).set(cleanEncodedBytes);
      const request: ScanCorruptionWorkerRequest = {
        id: 0,
        type: "corrupt",
        bytes: inputBuffer,
        stages,
      };
      worker.postMessage(request, [inputBuffer]);
    } catch {
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message:
            "The clean encoded JPEG could not be sent to the Scan Corrupt worker.",
        }),
      );
    }
  });
}
