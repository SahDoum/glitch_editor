import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";
import { failure, success } from "../shared/result";
import type {
  CoefficientWorkerRequest,
  CoefficientWorkerResponse,
} from "./coefficient-worker-protocol";

const CODEC_ERRORS: Record<number, string> = {
  [-1]: "libjpeg-turbo could not decode coefficient data from this JPEG.",
  [-2]: "The coefficient reader does not support this JPEG coding process.",
  [-3]: "This JPEG requires more coefficient memory than the 128 MiB prototype limit.",
  [-4]: "The selected component or DCT block is outside the decoded image.",
};

let codecPromise: ReturnType<typeof createLibjpegCoefficients> | null = null;
let isOpen = false;
let requestQueue = Promise.resolve();

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

function isRequest(value: unknown): value is CoefficientWorkerRequest {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return false;
  }
  if (typeof value.id !== "number" || !Number.isInteger(value.id)) return false;
  if (!("type" in value)) return false;
  if (value.type === "open") {
    return "bytes" in value && value.bytes instanceof ArrayBuffer;
  }
  return (
    value.type === "read-block" &&
    "componentIndex" in value &&
    Number.isInteger(value.componentIndex) &&
    "blockX" in value &&
    Number.isInteger(value.blockX) &&
    "blockY" in value &&
    Number.isInteger(value.blockY)
  );
}

async function handleRequest(
  request: CoefficientWorkerRequest,
): Promise<CoefficientWorkerResponse> {
  const codec = await getCodec();
  if (request.type === "open") {
    const inputPointer = codec._malloc(request.bytes.byteLength);
    if (inputPointer === 0) {
      return {
        id: request.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message: "There was not enough memory to read JPEG coefficients.",
        }),
      };
    }

    try {
      codec.HEAPU8.set(new Uint8Array(request.bytes), inputPointer);
      const status = codec._coefficient_open(
        inputPointer,
        request.bytes.byteLength,
      );
      if (status !== 0) {
        isOpen = false;
        const message =
          CODEC_ERRORS[status] ??
          "libjpeg-turbo could not open this JPEG for coefficient inspection.";
        return {
          id: request.id,
          result: failure({
            code: status === -2 ? "UNSUPPORTED_FORMAT" : "PROCESSING_FAILED",
            message,
          }),
        };
      }
      isOpen = true;
      return {
        id: request.id,
        result: success({ type: "opened" }),
      };
    } finally {
      codec._free(inputPointer);
    }
  }

  if (!isOpen) {
    return {
      id: request.id,
      result: failure({
        code: "PROCESSING_FAILED",
        message: "The JPEG coefficient reader has not been initialized.",
      }),
    };
  }

  const outputPointer = codec._malloc(64 * Int16Array.BYTES_PER_ELEMENT);
  if (outputPointer === 0) {
    return {
      id: request.id,
      result: failure({
        code: "PROCESSING_FAILED",
        message: "There was not enough memory to read the selected DCT block.",
      }),
    };
  }

  try {
    const status = codec._coefficient_read_block(
      request.componentIndex,
      request.blockX,
      request.blockY,
      outputPointer,
    );
    if (status !== 0) {
      return {
        id: request.id,
        result: failure({
          code: "INVALID_INPUT",
          message: CODEC_ERRORS[status] ?? "The selected DCT block is invalid.",
        }),
      };
    }
    const values = Array.from(
      new Int16Array(codec.HEAPU8.buffer, outputPointer, 64),
    );
    return {
      id: request.id,
      result: success({ type: "block", values }),
    };
  } finally {
    codec._free(outputPointer);
  }
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isRequest(event.data)) {
    self.postMessage({
      id: -1,
      result: failure({
        code: "INVALID_INPUT",
        message: "The coefficient inspection request was invalid.",
      }),
    } satisfies CoefficientWorkerResponse);
    return;
  }

  const request = event.data;
  requestQueue = requestQueue.then(async () => {
    try {
      self.postMessage(await handleRequest(request));
    } catch {
      isOpen = false;
      codecPromise = null;
      self.postMessage({
        id: request.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message:
            "The libjpeg-turbo WebAssembly module could not be loaded. Build it with Emscripten using npm run build:jpeg-codec.",
        }),
      } satisfies CoefficientWorkerResponse);
    }
  });
});
