import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";
import {
  getMaskBlockCoverage,
  getMaskBlockCoverageAtLeastHalf,
} from "./block-geometry";
import { isSpatialMask } from "../document/masks";
import {
  COEFFICIENT_DOMAINS,
  COEFFICIENT_GLITCH_MODES,
  GLITCH_FREQUENCY_BANDS,
  MAX_BLOCK_TRANSFER_BLOCKS,
  MAX_GLITCH_OPERATIONS,
  QUANTIZATION_PATTERNS,
  QUANTIZATION_SEMANTICS,
  type JpegGlitchOperation,
} from "../operations/jpeg-glitch";
import { failure, success } from "../shared/result";
import type {
  CoefficientWorkerRequest,
  CoefficientWorkerResponse,
} from "./coefficient-worker-protocol";
import type { JpegBlockGeometry } from "./block-geometry";

const CODEC_ERRORS: Record<number, string> = {
  [-1]: "libjpeg-turbo could not decode coefficient data from this JPEG.",
  [-2]: "The coefficient reader does not support this JPEG coding process.",
  [-3]: "This JPEG requires more coefficient memory than the 256 MiB limit.",
  [-4]: "The selected component or DCT block is outside the decoded image.",
  [-5]: "The encoded JPEG exceeds the 50 MiB output limit.",
  [-6]: "The DCT edit parameters do not match the decoded JPEG.",
  [-7]: "The selected quantization table or its 64 values are invalid.",
  [-8]: "The local block shift exceeds 262,144 destination blocks. Use a smaller mask.",
};
const MAX_JPEG_BYTES = 50 * 1024 * 1024;
// Bump when the generated codec changes so older cached WASM cannot be reused.
const CODEC_VERSION = "engraving-1";
const MAX_EDITED_BLOCKS = 8 * 1024 * 1024;
const MAX_EDIT_COUNT = MAX_GLITCH_OPERATIONS;
const FREQUENCY_BAND_INDEX = {
  low: 0,
  mid: 1,
  high: 2,
  all: 3,
} as const;
const GLITCH_MODE_INDEX = {
  zero: 0,
  scale: 1,
  randomize: 2,
  offset: 3,
  invert: 4,
  isolate: 5,
  "dc-steps": 6,
  "low-pass": 7,
  "ringing-boost": 8,
  "engrave-horizontal": 9,
  "engrave-vertical": 10,
} as const;
const COEFFICIENT_DOMAIN_INDEX = {
  ac: 0,
  dc: 1,
} as const;
const QUANTIZATION_SEMANTICS_INDEX = {
  reinterpret: 0,
  requantize: 1,
} as const;

let codecPromise: ReturnType<typeof createLibjpegCoefficients> | null = null;
let isOpen = false;
let requestQueue = Promise.resolve();

function getCodec() {
  const moduleUrl = new URL(
    `${import.meta.env.BASE_URL}codec/libjpeg-coefficients.js?v=${CODEC_VERSION}`,
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
              `${import.meta.env.BASE_URL}codec/libjpeg-coefficients.wasm?v=${CODEC_VERSION}`,
              self.location.origin,
            ).href
          : path;
      },
    }).then((codec) => {
      const requiredExports = [
        "_coefficient_open",
        "_coefficient_read_block",
        "_coefficient_apply",
        "_coefficient_repeat_block",
        "_coefficient_permute_blocks",
        "_coefficient_shift_blocks",
        "_coefficient_transfer_blocks",
        "_coefficient_set_quantization",
        "_coefficient_encode",
        "_coefficient_output_pointer",
        "_coefficient_output_size",
        "_coefficient_close",
      ];
      if (
        requiredExports.some(
          (name) => typeof Reflect.get(codec, name) !== "function",
        )
      ) {
        throw new Error("The generated JPEG codec is outdated.");
      }
      return codec;
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
  const operations: unknown = Reflect.get(value, "operations");
  const bytes: unknown = Reflect.get(value, "bytes");
  if (
    value.type !== "encode" ||
    !(bytes instanceof ArrayBuffer) ||
    !isGeometry(geometry) ||
    !Array.isArray(operations) ||
    operations.length > MAX_EDIT_COUNT ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_JPEG_BYTES
  ) {
    return false;
  }
  return (
    operations.every((operation: unknown) =>
      isGlitchOperation(operation, geometry),
    ) && isBoundedOperationWork(geometry, operations)
  );
}

function isGlitchOperation(
  value: unknown,
  geometry: JpegBlockGeometry,
): value is JpegGlitchOperation {
  if (typeof value !== "object" || value === null) return false;
  const kind = Reflect.get(value, "kind");
  if (kind === "coefficients") {
    const componentIndex = Reflect.get(value, "componentIndex");
    const frequencyBand = Reflect.get(value, "frequencyBand");
    const domain = Reflect.get(value, "domain");
    const mode = Reflect.get(value, "mode");
    const strength = Reflect.get(value, "strength");
    const seed = Reflect.get(value, "seed");
    const mask = Reflect.get(value, "mask");
    return (
      typeof componentIndex === "number" &&
      Number.isInteger(componentIndex) &&
      componentIndex >= 0 &&
      componentIndex < geometry.components.length &&
      typeof frequencyBand === "string" &&
      GLITCH_FREQUENCY_BANDS.some((band) => band === frequencyBand) &&
      typeof domain === "string" &&
      COEFFICIENT_DOMAINS.some((candidate) => candidate === domain) &&
      typeof mode === "string" &&
      COEFFICIENT_GLITCH_MODES.some((candidate) => candidate === mode) &&
      typeof strength === "number" &&
      Number.isFinite(strength) &&
      typeof seed === "number" &&
      Number.isInteger(seed) &&
      seed >= 0 &&
      seed <= 0xffff_ffff &&
      ((mode === "scale" && strength >= -8 && strength <= 8) ||
        (mode === "randomize" && strength >= 1 && strength <= 2047) ||
        (mode === "offset" &&
          domain === "dc" &&
          Number.isInteger(strength) &&
          strength >= -2047 &&
          strength <= 2047) ||
        (mode === "dc-steps" &&
          domain === "dc" &&
          Number.isInteger(strength) &&
          strength >= 1 &&
          strength <= 512) ||
        (mode === "low-pass" &&
          domain === "ac" &&
          frequencyBand === "all" &&
          Number.isInteger(strength) &&
          strength >= 1 &&
          strength <= 14) ||
        ((mode === "ringing-boost" ||
          mode === "engrave-horizontal" ||
          mode === "engrave-vertical") &&
          domain === "ac" &&
          frequencyBand === "all" &&
          strength >= 1 &&
          strength <= 8) ||
        ((mode === "invert" || mode === "isolate") &&
          domain === "ac" &&
          strength === 0 &&
          (mode !== "isolate" || frequencyBand !== "all")) ||
        mode === "zero") &&
      (mode !== "offset" || domain === "dc") &&
      (mode !== "invert" || domain === "ac") &&
      (mode !== "isolate" || domain === "ac") &&
      (domain !== "dc" || frequencyBand === "all") &&
      isSpatialMask(mask) &&
      mask.width === geometry.width &&
      mask.height === geometry.height
    );
  }
  if (kind === "block-repeat") {
    const componentIndex = Reflect.get(value, "componentIndex");
    const sourceX = Reflect.get(value, "sourceX");
    const sourceY = Reflect.get(value, "sourceY");
    const offsetX = Reflect.get(value, "offsetX");
    const offsetY = Reflect.get(value, "offsetY");
    const repetitions = Reflect.get(value, "repetitions");
    if (
      typeof componentIndex !== "number" ||
      !Number.isInteger(componentIndex) ||
      componentIndex < 0 ||
      componentIndex >= geometry.components.length ||
      !isInteger(sourceX) ||
      !isInteger(sourceY) ||
      !isInteger(offsetX) ||
      !isInteger(offsetY) ||
      !isInteger(repetitions) ||
      (offsetX === 0 && offsetY === 0) ||
      Math.abs(offsetX) > 256 ||
      Math.abs(offsetY) > 256 ||
      repetitions < 1 ||
      repetitions > 256
    ) {
      return false;
    }
    const component = geometry.components[componentIndex];
    if (!component) return false;
    const grid = getComponentBlockGrid(geometry, component);
    if (
      sourceX < 0 ||
      sourceY < 0 ||
      sourceX >= grid.columns ||
      sourceY >= grid.rows
    ) {
      return false;
    }
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const targetX = sourceX + offsetX * repetition;
      const targetY = sourceY + offsetY * repetition;
      if (
        targetX < 0 ||
        targetY < 0 ||
        targetX >= grid.columns ||
        targetY >= grid.rows
      ) {
        return false;
      }
    }
    return true;
  }
  if (kind === "block-permutation") {
    const componentIndex = Reflect.get(value, "componentIndex");
    const mask = Reflect.get(value, "mask");
    const seed = Reflect.get(value, "seed");
    return (
      isInteger(componentIndex) &&
      componentIndex >= 0 &&
      componentIndex < geometry.components.length &&
      isSpatialMask(mask) &&
      mask.width === geometry.width &&
      mask.height === geometry.height &&
      isInteger(seed) &&
      seed >= 0 &&
      seed <= 0xffff_ffff
    );
  }
  if (kind === "block-shift") {
    const componentIndex = Reflect.get(value, "componentIndex");
    const mask = Reflect.get(value, "mask");
    const offsetX = Reflect.get(value, "offsetX");
    const offsetY = Reflect.get(value, "offsetY");
    return (
      isInteger(componentIndex) &&
      componentIndex >= 0 &&
      componentIndex < geometry.components.length &&
      isSpatialMask(mask) &&
      mask.width === geometry.width &&
      mask.height === geometry.height &&
      isInteger(offsetX) &&
      Math.abs(offsetX) <= 256 &&
      isInteger(offsetY) &&
      Math.abs(offsetY) <= 256 &&
      (offsetX !== 0 || offsetY !== 0)
    );
  }
  if (kind === "block-transfer") {
    const componentIndex = Reflect.get(value, "componentIndex");
    const sourceX = Reflect.get(value, "sourceX");
    const sourceY = Reflect.get(value, "sourceY");
    const width = Reflect.get(value, "width");
    const height = Reflect.get(value, "height");
    const destinationX = Reflect.get(value, "destinationX");
    const destinationY = Reflect.get(value, "destinationY");
    const mode = Reflect.get(value, "mode");
    const action = Reflect.get(value, "action");
    if (
      !isInteger(componentIndex) ||
      componentIndex < 0 ||
      componentIndex >= geometry.components.length ||
      !isInteger(sourceX) ||
      !isInteger(sourceY) ||
      !isInteger(width) ||
      !isInteger(height) ||
      !isInteger(destinationX) ||
      !isInteger(destinationY) ||
      sourceX < 0 ||
      sourceY < 0 ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_BLOCK_TRANSFER_BLOCKS ||
      destinationX < 0 ||
      destinationY < 0 ||
      (mode !== "all" && mode !== "dc" && mode !== "ac") ||
      (action !== "copy" && action !== "swap")
    ) {
      return false;
    }
    const component = geometry.components[componentIndex];
    if (!component) return false;
    const grid = getComponentBlockGrid(geometry, component);
    const overlaps =
      sourceX < destinationX + width &&
      destinationX < sourceX + width &&
      sourceY < destinationY + height &&
      destinationY < sourceY + height;
    return (
      sourceX + width <= grid.columns &&
      sourceY + height <= grid.rows &&
      destinationX + width <= grid.columns &&
      destinationY + height <= grid.rows &&
      (action !== "swap" ||
        !overlaps ||
        (sourceX === destinationX && sourceY === destinationY))
    );
  }
  if (kind !== "quantization") return false;
  const tableId = Reflect.get(value, "tableId");
  const values: unknown = Reflect.get(value, "values");
  const semantics = Reflect.get(value, "semantics");
  const pattern = Reflect.get(value, "pattern");
  const seed = Reflect.get(value, "seed");
  return (
    typeof tableId === "number" &&
    Number.isInteger(tableId) &&
    tableId >= 0 &&
    tableId <= 3 &&
    geometry.components.some(
      (component) => component.quantizationTable === tableId,
    ) &&
    Array.isArray(values) &&
    values.length === 64 &&
    values.every(isQuantizationValue) &&
    typeof semantics === "string" &&
    QUANTIZATION_SEMANTICS.some((candidate) => candidate === semantics) &&
    (pattern === "manual" ||
      (typeof pattern === "string" &&
        QUANTIZATION_PATTERNS.some((candidate) => candidate === pattern))) &&
    isInteger(seed) &&
    seed >= 0 &&
    seed <= 0xffff_ffff
  );
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isQuantizationValue(value: unknown): value is number {
  return isInteger(value) && value >= 1 && value <= 255;
}

function getComponentBlockGrid(
  geometry: JpegBlockGeometry,
  component: JpegBlockGeometry["components"][number],
) {
  const maxHorizontalSampling = Math.max(
    ...geometry.components.map(({ horizontalSampling }) => horizontalSampling),
  );
  const maxVerticalSampling = Math.max(
    ...geometry.components.map(({ verticalSampling }) => verticalSampling),
  );
  return {
    columns: Math.ceil(
      (geometry.width * component.horizontalSampling) /
        (8 * maxHorizontalSampling),
    ),
    rows: Math.ceil(
      (geometry.height * component.verticalSampling) /
        (8 * maxVerticalSampling),
    ),
  };
}

function getOperationWorkSize(
  geometry: JpegBlockGeometry,
  operation: JpegGlitchOperation,
): number {
  if (operation.kind === "coefficients") {
    const component = geometry.components[operation.componentIndex];
    if (!component) return 0;
    const grid = getComponentBlockGrid(geometry, component);
    return grid.columns * grid.rows;
  }
  if (operation.kind === "block-repeat") return operation.repetitions;
  if (
    operation.kind === "block-permutation" ||
    operation.kind === "block-shift"
  ) {
    const component = geometry.components[operation.componentIndex];
    if (!component) return 0;
    const grid = getComponentBlockGrid(geometry, component);
    return grid.columns * grid.rows;
  }
  if (operation.kind === "block-transfer") {
    return operation.width * operation.height * 2;
  }
  if (operation.semantics === "reinterpret") return 0;
  return geometry.components.reduce((total, component) => {
    if (component.quantizationTable !== operation.tableId) return total;
    const grid = getComponentBlockGrid(geometry, component);
    return total + grid.columns * grid.rows;
  }, 0);
}

function isBoundedOperationWork(
  geometry: JpegBlockGeometry,
  operations: readonly JpegGlitchOperation[],
): boolean {
  return (
    operations.reduce(
      (total, operation) => total + getOperationWorkSize(geometry, operation),
      0,
    ) <= MAX_EDITED_BLOCKS
  );
}

function isGeometry(value: unknown): value is JpegBlockGeometry {
  if (typeof value !== "object" || value === null) return false;
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
    const quantizationTable = Reflect.get(component, "quantizationTable");
    return (
      isInteger(id) &&
      isInteger(horizontalSampling) &&
      horizontalSampling >= 1 &&
      horizontalSampling <= 4 &&
      isInteger(verticalSampling) &&
      verticalSampling >= 1 &&
      verticalSampling <= 4 &&
      isInteger(quantizationTable) &&
      quantizationTable >= 0 &&
      quantizationTable <= 3
    );
  });
}

async function handleRequest(
  request: CoefficientWorkerRequest,
): Promise<CoefficientWorkerResponse> {
  if (
    request.type === "encode" &&
    !isBoundedOperationWork(request.geometry, request.operations)
  ) {
    return {
      id: request.id,
      result: failure({
        code: "PROCESSING_FAILED",
        message:
          "This JPEG glitch preview exceeds the worker's bounded processing limit. Use a smaller image or fewer operations.",
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

      for (const operation of request.operations) {
        if (operation.kind === "coefficients") {
          const component =
            request.geometry.components[operation.componentIndex];
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
            operation.mask,
            request.geometry,
            component.id,
          );
          if (!coverage.ok) return { id: request.id, result: coverage };
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
            status = codec._coefficient_apply(
              operation.componentIndex,
              GLITCH_MODE_INDEX[operation.mode],
              COEFFICIENT_DOMAIN_INDEX[operation.domain],
              FREQUENCY_BAND_INDEX[operation.frequencyBand],
              maskPointer,
              blockMask.byteLength,
              operation.strength,
              operation.seed,
            );
          } finally {
            codec._free(maskPointer);
          }
        } else if (operation.kind === "block-repeat") {
          status = codec._coefficient_repeat_block(
            operation.componentIndex,
            operation.sourceX,
            operation.sourceY,
            operation.offsetX,
            operation.offsetY,
            operation.repetitions,
          );
        } else if (
          operation.kind === "block-permutation" ||
          operation.kind === "block-shift"
        ) {
          const component =
            request.geometry.components[operation.componentIndex];
          if (!component) {
            return {
              id: request.id,
              result: failure({
                code: "INVALID_INPUT",
                message: "The selected JPEG component is invalid.",
              }),
            };
          }
          const coverage = getMaskBlockCoverageAtLeastHalf(
            operation.mask,
            request.geometry,
            component.id,
          );
          if (!coverage.ok) return { id: request.id, result: coverage };
          const maskPointer = codec._malloc(coverage.value.byteLength);
          if (maskPointer === 0) {
            return {
              id: request.id,
              result: failure({
                code: "PROCESSING_FAILED",
                message:
                  "There was not enough memory to prepare the block selection mask.",
              }),
            };
          }
          try {
            codec.HEAPU8.set(coverage.value, maskPointer);
            status =
              operation.kind === "block-permutation"
                ? codec._coefficient_permute_blocks(
                    operation.componentIndex,
                    maskPointer,
                    coverage.value.byteLength,
                    operation.seed,
                  )
                : codec._coefficient_shift_blocks(
                    operation.componentIndex,
                    maskPointer,
                    coverage.value.byteLength,
                    operation.offsetX,
                    operation.offsetY,
                  );
          } finally {
            codec._free(maskPointer);
          }
        } else if (operation.kind === "block-transfer") {
          if (typeof codec._coefficient_transfer_blocks !== "function") {
            return {
              id: request.id,
              result: failure({
                code: "PROCESSING_FAILED",
                message:
                  "The generated JPEG codec is outdated. Rebuild the codec bridge before applying block transfers.",
              }),
            };
          }
          status = codec._coefficient_transfer_blocks(
            operation.componentIndex,
            operation.sourceX,
            operation.sourceY,
            operation.width,
            operation.height,
            operation.destinationX,
            operation.destinationY,
            operation.mode === "all" ? 0 : operation.mode === "dc" ? 1 : 2,
            operation.action === "copy" ? 0 : 1,
          );
        } else {
          const values = Uint8Array.from(operation.values);
          const valuesPointer = codec._malloc(values.byteLength);
          if (valuesPointer === 0) {
            return {
              id: request.id,
              result: failure({
                code: "PROCESSING_FAILED",
                message:
                  "There was not enough memory to prepare the quantization table.",
              }),
            };
          }
          try {
            codec.HEAPU8.set(values, valuesPointer);
            status = codec._coefficient_set_quantization(
              operation.tableId,
              QUANTIZATION_SEMANTICS_INDEX[operation.semantics],
              valuesPointer,
              values.byteLength,
            );
          } finally {
            codec._free(valuesPointer);
          }
        }

        if (status !== 0) {
          return {
            id: request.id,
            result: failure({
              code:
                status === -4 || status === -7
                  ? "INVALID_INPUT"
                  : "PROCESSING_FAILED",
              message:
                CODEC_ERRORS[status] ??
                "The JPEG glitch operation could not be applied.",
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
