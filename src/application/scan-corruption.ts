import { failure, success, type Result } from "../shared/result";
import { isWorkerResult } from "./worker-response";
import type {
  ScanDecodeDiagnostic,
  ScanCorruptionWorkerRequest,
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

  /** Publish the exact stage snapshot that completed in the worker as one action. */
  commitStages(stages: readonly ScanCorruptionParameters[]): Result<undefined> {
    if (
      !Array.isArray(stages) ||
      stages.length === 0 ||
      stages.length > MAX_SCAN_CORRUPTION_STAGES ||
      !stages.every(isScanCorruptionParameters)
    ) {
      return failure({
        code: "INVALID_INPUT",
        message:
          "The completed Scan Corrupt stages are invalid or exceed the eight-stage limit.",
      });
    }
    const snapshot = stages.map((stage) => Object.freeze({ ...stage }));
    this.past.push(this.active);
    this.active = snapshot;
    this.future.length = 0;
    return success(undefined);
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
    return this.commitStages([...this.active, parameters]);
  }

  replaceLast(parameters: ScanCorruptionParameters): Result<undefined> {
    if (!isScanCorruptionParameters(parameters) || this.active.length === 0) {
      return failure({
        code: "INVALID_INPUT",
        message: "There is no valid Scan Corrupt stage to update.",
      });
    }
    return this.commitStages([...this.active.slice(0, -1), parameters]);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDiagnostic(value: unknown): value is ScanDecodeDiagnostic {
  return (
    isRecord(value) &&
    value.decoder === "libjpeg-turbo" &&
    typeof value.status === "string" &&
    ["complete", "warnings", "incomplete", "failed", "unavailable"].includes(
      value.status,
    ) &&
    isNonnegativeInteger(value.decodedRows) &&
    isNonnegativeInteger(value.expectedRows) &&
    value.decodedRows <= value.expectedRows &&
    isNonnegativeInteger(value.warningCount) &&
    isNonnegativeInteger(value.warningFlags) &&
    typeof value.message === "string"
  );
}

function parseWorkerResponse(
  response: unknown,
  byteLength: number,
  stages: readonly ScanCorruptionParameters[],
): Result<CorruptedEncodedJpeg> {
  const invalid = () =>
    failure({
      code: "PROCESSING_FAILED" as const,
      message: "The Scan Corrupt worker returned an invalid response.",
    });
  if (
    !isRecord(response) ||
    response.id !== 0 ||
    !isWorkerResult(response.result, isRecord)
  ) {
    return invalid();
  }
  const result = response.result;
  if (!result.ok) return result;
  const value = result.value;
  if (
    value.type !== "corrupted" ||
    !(value.bytes instanceof ArrayBuffer) ||
    value.bytes.byteLength !== byteLength ||
    !Array.isArray(value.reports) ||
    value.reports.length !== stages.length ||
    !isDiagnostic(value.diagnostic)
  )
    return invalid();
  const reports: ScanCorruptionReport[] = [];
  for (const [index, report] of value.reports.entries()) {
    const stage = stages[index]!;
    if (
      !isRecord(report) ||
      !isScanCorruptionParameters(report) ||
      report.mode !== stage.mode ||
      report.count !== stage.count ||
      report.rangeStart !== stage.rangeStart ||
      report.rangeEnd !== stage.rangeEnd ||
      report.seed !== stage.seed ||
      !isNonnegativeInteger(report.scanStartOffset) ||
      !isNonnegativeInteger(report.scanEndOffset) ||
      report.scanStartOffset >= report.scanEndOffset ||
      report.scanEndOffset > byteLength ||
      report.changedBytes !== stage.count ||
      !isNonnegativeInteger(report.changedBits) ||
      report.changedBits < stage.count ||
      report.changedBits > stage.count * (stage.mode === "bit-flip" ? 1 : 8)
    )
      return invalid();
    reports.push({
      ...stage,
      scanStartOffset: report.scanStartOffset,
      scanEndOffset: report.scanEndOffset,
      changedBytes: stage.count,
      changedBits: report.changedBits,
    });
  }
  return success({
    bytes: new Uint8Array(value.bytes),
    reports,
    diagnostic: value.diagnostic,
  });
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

  const requestedStages = stages.map((stage) => Object.freeze({ ...stage }));
  const byteLength = cleanEncodedBytes.byteLength;
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
          message: "Scan corruption was cancelled.",
        }),
      );

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return;
      finish(parseWorkerResponse(event.data, byteLength, requestedStages));
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
        stages: requestedStages,
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
