import { isSpatialMask, type SpatialMask } from "../document/masks";
import {
  isScanCorruptionParameters,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
} from "../jpeg/scan-corruption";
import {
  parseOperationRecord,
  type OperationRecord,
} from "../operations/schema";
import { failure, success, type Result } from "../shared/result";
import { getOperationController } from "../jpeg/codec-controllers/registry";
import { inspectJpeg, type JpegInspection } from "../jpeg/inspect";
import { planJpegOperations } from "../application/jpeg-document";
import { isWorkerResult } from "../application/worker-response";
import type {
  ProjectReadWorkerRequest,
  ProjectReadWorkerResponse,
} from "./project-worker-protocol";

export const JGE_PROJECT_FORMAT = "jpeg-glitch-editor-project";
export const JGE_PROJECT_SCHEMA_VERSION = 2;
export const MAX_PROJECT_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_PROJECT_FILE_BYTES =
  Math.ceil(MAX_PROJECT_SOURCE_BYTES / 3) * 4 + 1024 * 1024;
const MAX_PROJECT_OPERATIONS = 10_000;
const MAX_SOURCE_FILE_NAME_LENGTH = 255;
const BASE64_CHUNK_SIZE = 0x7ffe;
const BASE64_DECODE_CHUNK_SIZE = 0x7ffc;
const BASE64_YIELD_INTERVAL = 16;

export interface JgeProjectSaveData {
  readonly source: {
    readonly fileName: string;
    readonly sha256: string;
    readonly bytes: Uint8Array;
    /** Inspection of these same verified source bytes; never serialized. */
    readonly inspection?: JpegInspection;
  };
  readonly operations: readonly OperationRecord[];
  readonly draftMask: SpatialMask | null;
  readonly scanCorruptionStages: readonly ScanCorruptionParameters[];
}

export interface JgeProjectData {
  readonly applicationVersion: string;
  readonly codecVersion: string;
  readonly source: {
    readonly fileName: string;
    readonly sha256: string;
    readonly bytes: Uint8Array;
    /** Inspection of these same verified source bytes; never serialized. */
    readonly inspection?: JpegInspection;
  };
  readonly operations: readonly OperationRecord[];
  readonly draftMask: SpatialMask | null;
  readonly scanCorruptionStages: readonly ScanCorruptionParameters[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationRecord(value: unknown): value is OperationRecord {
  const parsed = parseOperationRecord(value);
  if (!parsed.ok) return false;
  const operation = parsed.value;
  const controller = getOperationController(operation.type);
  return (
    controller !== undefined &&
    operation.version === 1 &&
    isRecord(operation.parameters) &&
    operation.parameters.kind === controller.kind
  );
}

function validateProjectEdits(
  bytes: Uint8Array,
  operations: readonly OperationRecord[],
  draftMask: SpatialMask | null,
  verifiedInspection?: JpegInspection,
): Result<JpegInspection> {
  const inspection = verifiedInspection
    ? success(verifiedInspection)
    : inspectJpeg(bytes);
  if (!inspection.ok) return inspection;
  if (
    draftMask &&
    (draftMask.width !== inspection.value.width ||
      draftMask.height !== inspection.value.height)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project mask dimensions do not match its JPEG.",
    });
  }
  const plan = planJpegOperations(operations, inspection.value);
  return plan.ok ? success(inspection.value) : plan;
}

function utf8ByteLength(value: string): number {
  // Count without allocating another project-sized byte buffer.
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3; // Includes the replacement for an unpaired surrogate.
  }
  return bytes;
}

function isProjectData(value: unknown): value is JgeProjectData {
  return (
    isRecord(value) &&
    typeof value.applicationVersion === "string" &&
    typeof value.codecVersion === "string" &&
    isRecord(value.source) &&
    isSafeSourceFileName(value.source.fileName) &&
    typeof value.source.sha256 === "string" &&
    /^[\da-f]{64}$/i.test(value.source.sha256) &&
    value.source.bytes instanceof Uint8Array &&
    value.source.bytes.byteLength > 0 &&
    value.source.bytes.byteLength <= MAX_PROJECT_SOURCE_BYTES &&
    Array.isArray(value.operations) &&
    value.operations.length <= MAX_PROJECT_OPERATIONS &&
    value.operations.every(isOperationRecord) &&
    (value.draftMask === null || isSpatialMask(value.draftMask)) &&
    Array.isArray(value.scanCorruptionStages) &&
    value.scanCorruptionStages.length <= MAX_SCAN_CORRUPTION_STAGES &&
    value.scanCorruptionStages.every(isScanCorruptionParameters)
  );
}

function isSafeSourceFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_SOURCE_FILE_NAME_LENGTH &&
    !/[\\/]/.test(value) &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  );
}

async function bytesToBase64Chunks(bytes: Uint8Array): Promise<string[]> {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + BASE64_CHUNK_SIZE, bytes.length),
    );
    const nativeEncode: unknown = Reflect.get(chunk, "toBase64");
    if (typeof nativeEncode === "function") {
      const encoded: unknown = Reflect.apply(nativeEncode, chunk, []);
      if (typeof encoded !== "string")
        throw new TypeError("Invalid native Base64 result.");
      chunks.push(encoded);
    } else {
      chunks.push(btoa(String.fromCharCode(...chunk)));
    }
    if (
      chunks.length % BASE64_YIELD_INTERVAL === 0 &&
      offset + BASE64_CHUNK_SIZE < bytes.length
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return chunks;
}

function base64ToBytes(value: string): Result<Uint8Array> {
  const paddingLength = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - paddingLength;
  const hasValidPadding =
    (paddingLength === 0 && value.length % 4 === 0) ||
    (paddingLength === 1 && contentLength % 4 === 3) ||
    (paddingLength === 2 && contentLength % 4 === 2);
  if (value.length === 0 || !hasValidPadding) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project contains invalid embedded JPEG data.",
    });
  }

  for (let index = 0; index < contentLength; index += 1) {
    const character = value.charCodeAt(index);
    if (!(
      (character >= 0x41 && character <= 0x5a) ||
      (character >= 0x61 && character <= 0x7a) ||
      (character >= 0x30 && character <= 0x39) ||
      character === 0x2b ||
      character === 0x2f
    )) {
      return failure({
        code: "INVALID_INPUT",
        message: "The project contains invalid embedded JPEG data.",
      });
    }
  }

  // Require canonical zero padding bits in both native and fallback paths.
  const lastDigit =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
      value[contentLength - 1]!,
    );
  if (
    (paddingLength === 2 && (lastDigit & 15) !== 0) ||
    (paddingLength === 1 && (lastDigit & 3) !== 0)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project contains invalid embedded JPEG data.",
    });
  }
  const byteLength = (value.length / 4) * 3 - paddingLength;
  let bytes: Uint8Array;
  try {
    const nativeDecode: unknown = Reflect.get(Uint8Array, "fromBase64");
    if (typeof nativeDecode === "function") {
      const decoded: unknown = Reflect.apply(nativeDecode, Uint8Array, [
        value,
        { lastChunkHandling: "strict" },
      ]);
      if (!(decoded instanceof Uint8Array) || decoded.byteLength !== byteLength)
        throw new TypeError("Invalid native Base64 result.");
      return success(decoded);
    }
    bytes = new Uint8Array(byteLength);
    for (
      let offset = 0;
      offset < value.length;
      offset += BASE64_DECODE_CHUNK_SIZE
    ) {
      const end = Math.min(offset + BASE64_DECODE_CHUNK_SIZE, value.length);
      const binary = atob(value.slice(offset, end));
      for (let index = 0; index < binary.length; index += 1) {
        bytes[(offset / 4) * 3 + index] = binary.charCodeAt(index);
      }
    }
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "The project contains invalid embedded JPEG data.",
    });
  }
  return success(bytes);
}

function isProjectPayload(value: unknown): value is {
  format: typeof JGE_PROJECT_FORMAT;
  schemaVersion: typeof JGE_PROJECT_SCHEMA_VERSION;
  applicationVersion: string;
  codecVersion: string;
  source: {
    fileName: string;
    sha256: string;
    byteLength: number;
    jpegBase64: string;
  };
  operations: OperationRecord[];
  draftMask: SpatialMask | null;
  scanCorruptionStages: ScanCorruptionParameters[];
} {
  if (
    !isRecord(value) ||
    value.format !== JGE_PROJECT_FORMAT ||
    value.schemaVersion !== JGE_PROJECT_SCHEMA_VERSION ||
    typeof value.applicationVersion !== "string" ||
    value.applicationVersion.length === 0 ||
    value.applicationVersion.length > 64 ||
    typeof value.codecVersion !== "string" ||
    value.codecVersion.length === 0 ||
    value.codecVersion.length > 64 ||
    !isRecord(value.source) ||
    !isSafeSourceFileName(value.source.fileName) ||
    typeof value.source.sha256 !== "string" ||
    !/^[\da-f]{64}$/i.test(value.source.sha256) ||
    typeof value.source.byteLength !== "number" ||
    !Number.isSafeInteger(value.source.byteLength) ||
    value.source.byteLength <= 0 ||
    value.source.byteLength > MAX_PROJECT_SOURCE_BYTES ||
    typeof value.source.jpegBase64 !== "string" ||
    value.source.jpegBase64.length !==
      Math.ceil(value.source.byteLength / 3) * 4 ||
    !Array.isArray(value.operations) ||
    value.operations.length > MAX_PROJECT_OPERATIONS ||
    !value.operations.every(isOperationRecord) ||
    !Array.isArray(value.scanCorruptionStages) ||
    value.scanCorruptionStages.length > MAX_SCAN_CORRUPTION_STAGES ||
    !value.scanCorruptionStages.every(isScanCorruptionParameters) ||
    (value.draftMask !== null && !isSpatialMask(value.draftMask))
  ) {
    return false;
  }

  const ids = value.operations.map((operation) => operation.id);
  return new Set(ids).size === ids.length;
}

export async function createJgeProjectFile(
  data: JgeProjectSaveData,
  versions: { readonly application: string; readonly codec: string },
): Promise<Result<Blob>> {
  if (
    !isSafeSourceFileName(data.source.fileName) ||
    !/^[\da-f]{64}$/i.test(data.source.sha256) ||
    data.source.bytes.byteLength === 0 ||
    data.source.bytes.byteLength > MAX_PROJECT_SOURCE_BYTES ||
    data.operations.length > MAX_PROJECT_OPERATIONS ||
    !data.operations.every(isOperationRecord) ||
    new Set(data.operations.map((operation) => operation.id)).size !==
      data.operations.length ||
    (data.draftMask !== null && !isSpatialMask(data.draftMask)) ||
    data.scanCorruptionStages.length > MAX_SCAN_CORRUPTION_STAGES ||
    !data.scanCorruptionStages.every(isScanCorruptionParameters) ||
    typeof versions.application !== "string" ||
    versions.application.length === 0 ||
    versions.application.length > 64 ||
    typeof versions.codec !== "string" ||
    versions.codec.length === 0 ||
    versions.codec.length > 64
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project contains data outside the supported format.",
    });
  }

  const edits = validateProjectEdits(
    data.source.bytes,
    data.operations,
    data.draftMask,
    data.source.inspection,
  );
  if (!edits.ok) return edits;

  let prefix: string;
  let suffix: string;
  try {
    // Assemble explicit JSON parts without searching user-controlled metadata.
    prefix = `{"format":${JSON.stringify(JGE_PROJECT_FORMAT)},"schemaVersion":${JGE_PROJECT_SCHEMA_VERSION},"applicationVersion":${JSON.stringify(versions.application)},"codecVersion":${JSON.stringify(versions.codec)},"source":{"fileName":${JSON.stringify(data.source.fileName)},"sha256":${JSON.stringify(data.source.sha256)},"byteLength":${data.source.bytes.byteLength},"jpegBase64":"`;
    suffix = `"},"operations":${JSON.stringify(data.operations)},"draftMask":${JSON.stringify(data.draftMask)},"scanCorruptionStages":${JSON.stringify(data.scanCorruptionStages)}}`;
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The project file could not be created.",
    });
  }
  const encodedLength = Math.ceil(data.source.bytes.byteLength / 3) * 4;
  if (
    utf8ByteLength(prefix) + encodedLength + utf8ByteLength(suffix) >
    MAX_PROJECT_FILE_BYTES
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project file exceeds the supported size limit.",
    });
  }

  let jpegBase64Chunks: string[];
  try {
    jpegBase64Chunks = await bytesToBase64Chunks(data.source.bytes);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The original JPEG could not be embedded in the project file.",
    });
  }

  return success(
    new Blob([prefix, ...jpegBase64Chunks, suffix], {
      type: "application/vnd.jpeg-glitch-editor.project+json",
    }),
  );
}

export async function readJgeProjectText(
  serialized: string,
): Promise<Result<JgeProjectData>> {
  if (
    serialized.length === 0 ||
    serialized.length > MAX_PROJECT_FILE_BYTES ||
    utf8ByteLength(serialized) > MAX_PROJECT_FILE_BYTES
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project file is empty or exceeds the supported size limit.",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected project file is not valid JSON.",
    });
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== JGE_PROJECT_FORMAT ||
    parsed.schemaVersion !== JGE_PROJECT_SCHEMA_VERSION
  ) {
    return failure({
      code: "UNSUPPORTED_FORMAT",
      message: "The project format or schema version is not supported.",
    });
  }
  if (!isProjectPayload(parsed)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project data is invalid for this schema version.",
    });
  }

  const decoded = base64ToBytes(parsed.source.jpegBase64);
  if (!decoded.ok) return decoded;
  if (decoded.value.byteLength !== parsed.source.byteLength) {
    return failure({
      code: "INVALID_INPUT",
      message: "The embedded JPEG length does not match the project metadata.",
    });
  }

  let digest: ArrayBuffer;
  try {
    const digestInput = decoded.value.buffer;
    if (!(digestInput instanceof ArrayBuffer)) {
      throw new TypeError(
        "The decoded source is not backed by an ArrayBuffer.",
      );
    }
    digest = await crypto.subtle.digest("SHA-256", digestInput);
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The embedded JPEG integrity could not be verified.",
    });
  }
  const actualHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actualHash !== parsed.source.sha256.toLowerCase()) {
    return failure({
      code: "INVALID_INPUT",
      message: "The embedded JPEG failed its SHA-256 integrity check.",
    });
  }

  const edits = validateProjectEdits(
    decoded.value,
    parsed.operations,
    parsed.draftMask,
  );
  if (!edits.ok) return edits;

  return success({
    applicationVersion: parsed.applicationVersion,
    codecVersion: parsed.codecVersion,
    source: {
      fileName: parsed.source.fileName,
      sha256: actualHash,
      bytes: decoded.value,
      inspection: edits.value,
    },
    operations: Object.freeze(parsed.operations),
    draftMask: parsed.draftMask,
    scanCorruptionStages: Object.freeze(parsed.scanCorruptionStages),
  });
}

export async function readJgeProjectFile(
  file: File,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<Result<JgeProjectData>> {
  if (file.size === 0 || file.size > MAX_PROJECT_FILE_BYTES) {
    return failure({
      code: "INVALID_INPUT",
      message: "The project file is empty or exceeds the supported size limit.",
    });
  }
  if (typeof Worker === "undefined") {
    return failure({
      code: "PROCESSING_FAILED",
      message: "This browser does not support background project loading.",
    });
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("./project-file.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The project loader could not be started.",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<JgeProjectData>) => {
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
          message: "Project loading was cancelled.",
        }),
      );

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<ProjectReadWorkerResponse>) => {
      if (settled) return;
      const response: unknown = event.data;
      if (
        !isRecord(response) ||
        (response.type !== "progress" && response.type !== "result")
      ) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The project loader returned an unexpected response.",
          }),
        );
        return;
      }
      if (response.type === "progress") {
        if (typeof response.progress !== "string" || "result" in response) {
          finish(
            failure({
              code: "PROCESSING_FAILED",
              message: "The project loader returned invalid progress.",
            }),
          );
          return;
        }
        onProgress?.(response.progress);
        return;
      }
      if (
        "progress" in response ||
        !isWorkerResult(response.result, isProjectData)
      ) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The project loader returned an incomplete response.",
          }),
        );
        return;
      }
      finish(response.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "Project loading stopped unexpectedly.",
        }),
      );
    };
    worker.onmessageerror = () =>
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "The project loader returned unreadable data.",
        }),
      );
    try {
      const request: ProjectReadWorkerRequest = { file };
      worker.postMessage(request);
    } catch {
      finish(
        failure({
          code: "PROCESSING_FAILED",
          message: "The project file could not be sent to the project loader.",
        }),
      );
    }
  });
}
