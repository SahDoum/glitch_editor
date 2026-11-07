import { isSpatialMask, type SpatialMask } from "../document/masks";
import {
  isScanCorruptionParameters,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
} from "../jpeg/scan-corruption";
import {
  isJsonValue,
  type OperationRecord,
  type OperationStatus,
} from "../operations/schema";
import { failure, success, type Result } from "../shared/result";

export const JGE_PROJECT_FORMAT = "jpeg-glitch-editor-project";
export const JGE_PROJECT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_PROJECT_FILE_BYTES =
  Math.ceil(MAX_PROJECT_SOURCE_BYTES / 3) * 4 + 1024 * 1024;
const MAX_PROJECT_OPERATIONS = 10_000;
const MAX_SOURCE_FILE_NAME_LENGTH = 255;
const BASE64_CHUNK_SIZE = 0x7ffe;
const BASE64_DECODE_CHUNK_SIZE = 0x7ffc;
const BASE64_YIELD_INTERVAL = 16;

interface ProjectReadWorkerRequest {
  readonly id: number;
  readonly file: File;
}

interface ProjectReadWorkerResponse {
  readonly id: number;
  readonly result?: Result<JgeProjectData>;
  readonly progress?: string;
}

export interface JgeProjectSaveData {
  readonly source: {
    readonly fileName: string;
    readonly sha256: string;
    readonly bytes: Uint8Array;
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
  };
  readonly operations: readonly OperationRecord[];
  readonly draftMask: SpatialMask | null;
  readonly scanCorruptionStages: readonly ScanCorruptionParameters[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationStatus(value: unknown): value is OperationStatus {
  return (
    value === "queued" ||
    value === "previewing" ||
    value === "applied" ||
    value === "failed"
  );
}

function isOperationRecord(value: unknown): value is OperationRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.type !== "string" ||
    value.type.trim().length === 0 ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.enabled !== "boolean" ||
    typeof value.inputRevision !== "number" ||
    !Number.isSafeInteger(value.inputRevision) ||
    value.inputRevision < 0 ||
    !isOperationStatus(value.status) ||
    !isJsonValue(value.parameters)
  ) {
    return false;
  }
  return (
    (value.seed === undefined ||
      (typeof value.seed === "number" &&
        Number.isInteger(value.seed) &&
        value.seed >= 0 &&
        value.seed <= 0xffff_ffff)) &&
    (value.maskId === undefined ||
      (typeof value.maskId === "string" && value.maskId.length > 0)) &&
    (value.targetComponents === undefined ||
      (Array.isArray(value.targetComponents) &&
        value.targetComponents.every(
          (component) =>
            typeof component === "number" &&
            Number.isSafeInteger(component) &&
            component >= 0,
        ))) &&
    (value.diagnostics === undefined ||
      (Array.isArray(value.diagnostics) &&
        value.diagnostics.every((item) => typeof item === "string")))
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
    chunks.push(btoa(String.fromCharCode(...chunk)));
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

  const byteLength = (value.length / 4) * 3 - paddingLength;
  let bytes: Uint8Array;
  try {
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
  return (
    new Set(ids).size === ids.length &&
    (value.scanCorruptionStages.length === 0 ||
      value.operations.some(
        (operation) =>
          operation.enabled && operation.type.startsWith("jpeg/glitch/"),
      ))
  );
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
    (data.scanCorruptionStages.length > 0 &&
      !data.operations.some(
        (operation) =>
          operation.enabled && operation.type.startsWith("jpeg/glitch/"),
      )) ||
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

  let metadata: string;
  try {
    metadata = JSON.stringify({
      format: JGE_PROJECT_FORMAT,
      schemaVersion: JGE_PROJECT_SCHEMA_VERSION,
      applicationVersion: versions.application,
      codecVersion: versions.codec,
      source: {
        fileName: data.source.fileName,
        sha256: data.source.sha256,
        byteLength: data.source.bytes.byteLength,
        jpegBase64: "",
      },
      operations: data.operations,
      draftMask: data.draftMask,
      scanCorruptionStages: data.scanCorruptionStages,
    });
  } catch {
    return failure({
      code: "PROCESSING_FAILED",
      message: "The project file could not be created.",
    });
  }

  const fieldMarker = '"jpegBase64":""';
  const fieldOffset = metadata.indexOf(fieldMarker);
  if (fieldOffset < 0) {
    return failure({
      code: "INTERNAL",
      message: "The project file could not be assembled.",
    });
  }
  const valueOffset = fieldOffset + '"jpegBase64":'.length;
  const prefix = `${metadata.slice(0, valueOffset)}"`;
  const suffix = metadata.slice(fieldOffset + fieldMarker.length - 1);
  const encodedLength = Math.ceil(data.source.bytes.byteLength / 3) * 4;
  if (prefix.length + encodedLength + suffix.length > MAX_PROJECT_FILE_BYTES) {
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
  if (serialized.length === 0 || serialized.length > MAX_PROJECT_FILE_BYTES) {
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
  if (!isProjectPayload(parsed)) {
    return failure({
      code: "UNSUPPORTED_FORMAT",
      message: "The project format or schema version is not supported.",
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

  return success({
    applicationVersion: parsed.applicationVersion,
    codecVersion: parsed.codecVersion,
    source: {
      fileName: parsed.source.fileName,
      sha256: actualHash,
      bytes: decoded.value,
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
      const response = event.data;
      if (response.id !== 0) {
        finish(
          failure({
            code: "PROCESSING_FAILED",
            message: "The project loader returned an unexpected response.",
          }),
        );
        return;
      }
      if (response.progress) {
        onProgress?.(response.progress);
        return;
      }
      if (!response.result) {
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
      const request: ProjectReadWorkerRequest = { id: 0, file };
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
