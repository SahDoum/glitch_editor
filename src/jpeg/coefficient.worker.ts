import {
  getCoefficientCodec as getCodec,
  resetCodecLoader,
} from "./codec-loader";
import { openCoefficientInput } from "./codec-input";
import { getOperationController } from "./codec-controllers/registry";
import { failure, success } from "../shared/result";
import {
  isCoefficientWorkerRequest,
  MAX_JPEG_BYTES,
  type CoefficientWorkerRequest,
  type CoefficientWorkerResponse,
} from "./coefficient-worker-protocol";

const CODEC_ERRORS: Record<number, string> = {
  [-1]: "libjpeg-turbo could not decode coefficient data from this JPEG.",
  [-2]: "The coefficient reader does not support this JPEG coding process.",
  [-3]: "This JPEG requires more coefficient memory than the 256 MiB limit.",
  [-4]: "The selected component or DCT block is outside the decoded image.",
  [-5]: "The encoded JPEG exceeds the 50 MiB output limit.",
  [-6]: "The DCT edit parameters do not match the decoded JPEG.",
  [-7]: "The selected quantization table or its 64 values are invalid.",
  [-8]: "The local block shift exceeds 262,144 destination blocks. Use a smaller mask.",
  [-9]: "There was not enough memory to prepare the JPEG codec command.",
};
let isOpen = false;
let requestQueue = Promise.resolve();

async function handleEncodeRequest(
  request: Extract<CoefficientWorkerRequest, { type: "encode" }>,
): Promise<CoefficientWorkerResponse> {
  const codec = await getCodec();
  try {
    let status = openCoefficientInput(codec, request.bytes);
    if (status !== 0) {
      return {
        id: request.id,
        result: failure({
          code: status === -2 ? "UNSUPPORTED_FORMAT" : "PROCESSING_FAILED",
          message:
            CODEC_ERRORS[status] ??
            "libjpeg-turbo could not open this JPEG for DCT editing.",
        }),
      };
    }

    for (const operation of request.operations) {
      const controller = getOperationController(operation.kind);
      if (!controller) {
        return {
          id: request.id,
          result: failure({
            code: "INVALID_INPUT",
            message: "Unknown JPEG operation.",
          }),
        };
      }
      const execution = controller.apply(codec, operation, request.geometry);
      if (!execution.ok) {
        return { id: request.id, result: execution };
      }
      status = execution.value;
      if (status !== 0) {
        return {
          id: request.id,
          result: failure({
            code:
              status === -4 || status === -6 || status === -7
                ? "INVALID_INPUT"
                : "PROCESSING_FAILED",
            message:
              CODEC_ERRORS[status] ??
              "The JPEG glitch command could not be applied.",
          }),
        };
      }
    }

    status = codec._coefficient_encode(
      request.options.mode === "progressive" ? 1 : 0,
    );
    if (status !== 0) {
      return {
        id: request.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message:
            CODEC_ERRORS[status] ??
            "libjpeg-turbo could not re-encode this edited JPEG.",
        }),
      };
    }
    const outputPointer = codec._coefficient_output_pointer();
    const outputSize = codec._coefficient_output_size();
    if (
      outputPointer === 0 ||
      outputSize === 0 ||
      outputSize > MAX_JPEG_BYTES
    ) {
      return {
        id: request.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message: "The JPEG encoder returned invalid output data.",
        }),
      };
    }

    const output = codec.HEAPU8.slice(
      outputPointer,
      outputPointer + outputSize,
    );
    return {
      id: request.id,
      result: success({ type: "encoded", bytes: output.buffer }),
    };
  } finally {
    codec._coefficient_close();
    isOpen = false;
  }
}

async function handleRequest(
  request: CoefficientWorkerRequest,
): Promise<CoefficientWorkerResponse> {
  if (request.type === "encode") {
    return handleEncodeRequest(request);
  }

  const codec = await getCodec();
  if (request.type === "open") {
    const status = openCoefficientInput(codec, request.bytes);
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
  if (!isCoefficientWorkerRequest(event.data)) {
    self.postMessage({
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
        message: "The coefficient inspection request was invalid.",
      }),
    } satisfies CoefficientWorkerResponse);
    return;
  }

  const request = event.data;
  requestQueue = requestQueue.then(async () => {
    try {
      const response = await handleRequest(request);
      if (response.result.ok && response.result.value.type === "encoded") {
        self.postMessage(response, {
          transfer: [response.result.value.bytes],
        });
      } else {
        self.postMessage(response);
      }
    } catch {
      isOpen = false;
      resetCodecLoader();
      self.postMessage({
        id: request.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message:
            "The coefficient worker encountered an unexpected processing error.",
        }),
      } satisfies CoefficientWorkerResponse);
    }
  });
});
