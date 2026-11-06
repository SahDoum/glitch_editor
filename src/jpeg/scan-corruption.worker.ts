import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";
import { failure } from "../shared/result";
import type {
  ScanDecodeDiagnostic,
  ScanCorruptionWorkerRequest,
  ScanCorruptionWorkerResponse,
} from "./scan-corruption-worker-protocol";
import {
  corruptEntropyScan,
  isScanCorruptionParameters,
  MAX_SCAN_CORRUPTION_STAGES,
} from "./scan-corruption";

const workerScope = self as typeof self & {
  postMessage(
    message: ScanCorruptionWorkerResponse,
    transfer?: Transferable[],
  ): void;
};

let codecPromise: ReturnType<typeof createLibjpegCoefficients> | null = null;

function getCodec() {
  const moduleUrl = new URL(
    `${import.meta.env.BASE_URL}codec/libjpeg-coefficients.js`,
    self.location.origin,
  ).href;
  codecPromise ??= import(/* @vite-ignore */ moduleUrl).then((module) => {
    const createCodec = (
      module as { default: typeof createLibjpegCoefficients }
    ).default;
    return createCodec({
      locateFile(path) {
        return path.endsWith(".wasm")
          ? new URL(
              `${import.meta.env.BASE_URL}codec/libjpeg-coefficients.wasm`,
              self.location.origin,
            ).href
          : path;
      },
    });
  });
  return codecPromise;
}

function unavailableDiagnostic(message: string): ScanDecodeDiagnostic {
  return {
    decoder: "libjpeg-turbo",
    status: "unavailable",
    decodedRows: 0,
    expectedRows: 0,
    warningCount: 0,
    warningFlags: 0,
    message,
  };
}

async function diagnoseDecode(
  bytes: Uint8Array,
): Promise<ScanDecodeDiagnostic> {
  let codec: Awaited<ReturnType<typeof createLibjpegCoefficients>>;
  try {
    codec = await getCodec();
  } catch {
    return unavailableDiagnostic(
      "The libjpeg-turbo diagnostic decoder could not be loaded.",
    );
  }

  const requiredExports = [
    "_coefficient_decode_diagnostic",
    "_coefficient_decode_diagnostic_warning_count",
    "_coefficient_decode_diagnostic_warning_flags",
    "_coefficient_decode_diagnostic_decoded_rows",
    "_coefficient_decode_diagnostic_expected_rows",
  ];
  if (
    requiredExports.some(
      (name) => typeof Reflect.get(codec, name) !== "function",
    )
  ) {
    return unavailableDiagnostic(
      "The JPEG codec must be rebuilt to provide decode diagnostics.",
    );
  }

  const pointer = codec._malloc(bytes.byteLength);
  if (pointer === 0) {
    return unavailableDiagnostic(
      "The JPEG codec could not allocate memory for decode diagnostics.",
    );
  }

  try {
    codec.HEAPU8.set(bytes, pointer);
    const result = codec._coefficient_decode_diagnostic(
      pointer,
      bytes.byteLength,
    );
    const decodedRows = codec._coefficient_decode_diagnostic_decoded_rows();
    const expectedRows = codec._coefficient_decode_diagnostic_expected_rows();
    const warningCount = codec._coefficient_decode_diagnostic_warning_count();
    const warningFlags = codec._coefficient_decode_diagnostic_warning_flags();
    const status: ScanDecodeDiagnostic["status"] =
      result === 0
        ? "complete"
        : result === 1
          ? "warnings"
          : result === 2
            ? "incomplete"
            : "failed";
    return {
      decoder: "libjpeg-turbo",
      status,
      decodedRows,
      expectedRows,
      warningCount,
      warningFlags,
      message: "",
    };
  } finally {
    codec._free(pointer);
  }
}

function isRequest(value: unknown): value is ScanCorruptionWorkerRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const id = Reflect.get(value, "id");
  const bytes = Reflect.get(value, "bytes");
  const stages = Reflect.get(value, "stages");
  return (
    Number.isSafeInteger(id) &&
    id >= 0 &&
    Reflect.get(value, "type") === "corrupt" &&
    bytes instanceof ArrayBuffer &&
    Array.isArray(stages) &&
    stages.length > 0 &&
    stages.length <= MAX_SCAN_CORRUPTION_STAGES &&
    stages.every(isScanCorruptionParameters)
  );
}

workerScope.addEventListener(
  "message",
  async (event: MessageEvent<unknown>) => {
    if (!isRequest(event.data)) {
      workerScope.postMessage({
        id:
          typeof event.data === "object" &&
          event.data !== null &&
          "id" in event.data &&
          typeof event.data.id === "number" &&
          Number.isSafeInteger(event.data.id)
            ? event.data.id
            : -1,
        result: failure({
          code: "INVALID_INPUT",
          message: "The Scan Corrupt worker request was invalid.",
        }),
      });
      return;
    }

    const result = corruptEntropyScan(
      new Uint8Array(event.data.bytes),
      event.data.stages,
    );
    if (!result.ok) {
      workerScope.postMessage({ id: event.data.id, result });
      return;
    }

    const diagnostic = await diagnoseDecode(result.value.bytes);
    const output = new ArrayBuffer(result.value.bytes.byteLength);
    new Uint8Array(output).set(result.value.bytes);
    workerScope.postMessage(
      {
        id: event.data.id,
        result: {
          ok: true,
          value: {
            type: "corrupted",
            bytes: output,
            reports: result.value.reports,
            diagnostic,
          },
        },
      },
      [output],
    );
  },
);
