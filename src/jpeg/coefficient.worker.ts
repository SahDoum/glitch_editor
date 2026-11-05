import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";
import { getMaskBlockCoverage } from "./block-geometry";
import { isSpatialMask } from "../document/masks";
import { MAX_DCT_OPERATIONS } from "../operations/dct";
import { failure, success } from "../shared/result";
import type {
  CoefficientWorkerRequest,
  CoefficientWorkerResponse,
} from "./coefficient-worker-protocol";
import type { JpegBlockGeometry } from "./block-geometry";

const CODEC_ERRORS: Record<number, string> = {
  [-1]: "libjpeg-turbo could not decode coefficient data from this JPEG.",
  [-2]: "The coefficient reader does not support this JPEG coding process.",
  [-3]: "This JPEG requires more coefficient memory than the 128 MiB limit.",
  [-4]: "The selected component or DCT block is outside the decoded image.",
  [-5]: "The encoded JPEG exceeds the 50 MiB output limit.",
  [-6]: "The DCT edit parameters do not match the decoded JPEG.",
};
const MAX_JPEG_BYTES = 50 * 1024 * 1024;
const MAX_EDITED_BLOCKS = 8 * 1024 * 1024;
const MAX_EDIT_COUNT = MAX_DCT_OPERATIONS;
const FREQUENCY_BAND_INDEX = {
  low: 0,
  mid: 1,
  high: 2,
  all: 3,
} as const;

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
  if (value.type === "read-block") {
    return (
      "componentIndex" in value &&
      Number.isInteger(value.componentIndex) &&
      "blockX" in value &&
      Number.isInteger(value.blockX) &&
      "blockY" in value &&
      Number.isInteger(value.blockY)
    );
  }
  const geometry: unknown = Reflect.get(value, "geometry");
  const edits: unknown = Reflect.get(value, "edits");
  const bytes: unknown = Reflect.get(value, "bytes");
  if (
    value.type !== "encode" ||
    !(bytes instanceof ArrayBuffer) ||
    !isGeometry(geometry) ||
    !Array.isArray(edits) ||
    edits.length > MAX_EDIT_COUNT ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_JPEG_BYTES
  ) {
    return false;
  }
  return edits.every((edit: unknown) => isCoefficientEdit(edit, geometry));
}

type EncodedCoefficientEdit = Extract<
  CoefficientWorkerRequest,
  { type: "encode" }
>["edits"][number];

function isCoefficientEdit(
  value: unknown,
  geometry: JpegBlockGeometry,
): value is EncodedCoefficientEdit {
  if (typeof value !== "object" || value === null) return false;
  const componentIndex = Reflect.get(value, "componentIndex");
  const frequencyBand = Reflect.get(value, "frequencyBand");
  const mask = Reflect.get(value, "mask");
  return (
    typeof componentIndex === "number" &&
    Number.isInteger(componentIndex) &&
    componentIndex >= 0 &&
    componentIndex < geometry.components.length &&
    typeof frequencyBand === "string" &&
    Object.hasOwn(FREQUENCY_BAND_INDEX, frequencyBand) &&
    isSpatialMask(mask) &&
    mask.width === geometry.width &&
    mask.height === geometry.height
  );
}

function getEditWorkSize(
  geometry: JpegBlockGeometry,
  edits: readonly EncodedCoefficientEdit[],
): number {
  const maxHorizontalSampling = Math.max(
    ...geometry.components.map(({ horizontalSampling }) => horizontalSampling),
  );
  const maxVerticalSampling = Math.max(
    ...geometry.components.map(({ verticalSampling }) => verticalSampling),
  );
  return edits.reduce((total, edit) => {
    const component = geometry.components[edit.componentIndex];
    if (!component) return total;
    return (
      total +
      Math.ceil(
        (geometry.width * component.horizontalSampling) /
          (8 * maxHorizontalSampling),
      ) *
        Math.ceil(
          (geometry.height * component.verticalSampling) /
            (8 * maxVerticalSampling),
        )
    );
  }, 0);
}

function isGeometry(value: unknown): value is JpegBlockGeometry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");
  const components: unknown = Reflect.get(value, "components");
  if (
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    width * height > 40_000_000 ||
    !Array.isArray(components) ||
    (components.length !== 1 && components.length !== 3)
  ) {
    return false;
  }
  return components.every((component: unknown) => {
    if (typeof component !== "object" || component === null) return false;
    const id = Reflect.get(component, "id");
    const horizontalSampling = Reflect.get(component, "horizontalSampling");
    const verticalSampling = Reflect.get(component, "verticalSampling");
    return (
      Number.isInteger(id) &&
      Number.isInteger(horizontalSampling) &&
      horizontalSampling >= 1 &&
      horizontalSampling <= 4 &&
      Number.isInteger(verticalSampling) &&
      verticalSampling >= 1 &&
      verticalSampling <= 4
    );
  });
}

async function handleRequest(
  request: CoefficientWorkerRequest,
): Promise<CoefficientWorkerResponse> {
  if (
    request.type === "encode" &&
    getEditWorkSize(request.geometry, request.edits) > MAX_EDITED_BLOCKS
  ) {
    return {
      id: request.id,
      result: failure({
        code: "PROCESSING_FAILED",
        message:
          "This DCT preview exceeds the worker's bounded processing limit. Use a smaller image or fewer DCT operations.",
      }),
    };
  }
  const codec = await getCodec();
  if (request.type === "encode") {
    const inputPointer = codec._malloc(request.bytes.byteLength);
    if (inputPointer === 0) {
      return {
        id: request.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message: "There was not enough memory to prepare JPEG re-encoding.",
        }),
      };
    }

    try {
      codec.HEAPU8.set(new Uint8Array(request.bytes), inputPointer);
      let status = codec._coefficient_open(
        inputPointer,
        request.bytes.byteLength,
      );
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

      for (const edit of request.edits) {
        const component = request.geometry.components[edit.componentIndex];
        if (!component) {
          return {
            id: request.id,
            result: failure({
              code: "INVALID_INPUT",
              message: "The selected JPEG component is invalid.",
            }),
          };
        }
        const coverage = getMaskBlockCoverage(
          edit.mask,
          request.geometry,
          component.id,
        );
        if (!coverage.ok) {
          return {
            id: request.id,
            result: coverage,
          };
        }
        const blockMask = coverage.value;
        const maskPointer = codec._malloc(blockMask.byteLength);
        if (maskPointer === 0) {
          return {
            id: request.id,
            result: failure({
              code: "PROCESSING_FAILED",
              message: "There was not enough memory to prepare the DCT mask.",
            }),
          };
        }
        try {
          codec.HEAPU8.set(blockMask, maskPointer);
          status = codec._coefficient_zero_band(
            edit.componentIndex,
            FREQUENCY_BAND_INDEX[edit.frequencyBand],
            maskPointer,
            blockMask.byteLength,
          );
        } finally {
          codec._free(maskPointer);
        }

        if (status !== 0) {
          return {
            id: request.id,
            result: failure({
              code: "PROCESSING_FAILED",
              message:
                CODEC_ERRORS[status] ??
                "The DCT edit could not be applied to this JPEG.",
            }),
          };
        }
      }

      status = codec._coefficient_encode();
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
      const bytes = output.buffer;
      return {
        id: request.id,
        result: success({ type: "encoded", bytes }),
      };
    } finally {
      codec._coefficient_close();
      codec._free(inputPointer);
      isOpen = false;
    }
  }

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
