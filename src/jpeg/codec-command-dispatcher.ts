import type createLibjpegCoefficients from "./codec/libjpeg-coefficients.js";
import type { SpatialMask } from "../document/masks";
import type { JpegBlockGeometry } from "./block-geometry";
import {
  MAX_GLITCH_OPERATIONS,
  type JpegGlitchOperation,
} from "../operations/jpeg-glitch";
import { failure, type Result } from "../shared/result";
import {
  getCodecCommandWorkSize,
  isRegisteredCodecCommand,
} from "./codec-controllers/registry";

type Codec = Awaited<ReturnType<typeof createLibjpegCoefficients>>;

export type CodecCommandModule = Pick<
  Codec,
  | "HEAPU8"
  | "_malloc"
  | "_free"
  | "_coefficient_apply"
  | "_coefficient_repeat_block"
  | "_coefficient_permute_blocks"
  | "_coefficient_shift_blocks"
  | "_coefficient_transfer_blocks"
  | "_coefficient_set_quantization"
>;

export type CodecOperationCommand =
  | {
      readonly kind: "apply-coefficients";
      readonly componentIndex: number;
      readonly mode: number;
      readonly domain: number;
      readonly frequencyBand: number;
      readonly strength: number;
      readonly seed: number;
      readonly mask: SpatialMask;
    }
  | {
      readonly kind: "repeat-block";
      readonly componentIndex: number;
      readonly sourceX: number;
      readonly sourceY: number;
      readonly offsetX: number;
      readonly offsetY: number;
      readonly repetitions: number;
    }
  | {
      readonly kind: "permute-blocks";
      readonly componentIndex: number;
      readonly mask: SpatialMask;
      readonly seed: number;
    }
  | {
      readonly kind: "shift-blocks";
      readonly componentIndex: number;
      readonly mask: SpatialMask;
      readonly offsetX: number;
      readonly offsetY: number;
    }
  | {
      readonly kind: "transfer-blocks";
      readonly componentIndex: number;
      readonly sourceX: number;
      readonly sourceY: number;
      readonly width: number;
      readonly height: number;
      readonly destinationX: number;
      readonly destinationY: number;
      readonly mode: number;
      readonly action: number;
    }
  | {
      readonly kind: "set-quantization";
      readonly tableId: number;
      readonly semantics: number;
      readonly values: Uint8Array;
    };

const MAX_EDITED_BLOCKS = 8 * 1024 * 1024;
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
const COEFFICIENT_DOMAIN_INDEX = { ac: 0, dc: 1 } as const;
const FREQUENCY_BAND_INDEX = {
  low: 0,
  mid: 1,
  high: 2,
  all: 3,
} as const;
const QUANTIZATION_SEMANTICS_INDEX = {
  reinterpret: 0,
  requantize: 1,
} as const;
const BLOCK_TRANSFER_MODE_INDEX = { all: 0, dc: 1, ac: 2 } as const;
const BLOCK_TRANSFER_ACTION_INDEX = { copy: 0, swap: 1 } as const;

type OperationStrategy = {
  prepare(
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<CodecOperationCommand>;
};

const operationStrategies: Readonly<
  Record<JpegGlitchOperation["kind"], OperationStrategy>
> = {
  coefficients: {
    prepare(operation, geometry) {
      if (operation.kind !== "coefficients") return invalidOperation();
      return validCommand(
        {
          kind: "apply-coefficients",
          componentIndex: operation.componentIndex,
          mode: GLITCH_MODE_INDEX[operation.mode],
          domain: COEFFICIENT_DOMAIN_INDEX[operation.domain],
          frequencyBand: FREQUENCY_BAND_INDEX[operation.frequencyBand],
          strength: operation.strength,
          seed: operation.seed,
          mask: operation.mask,
        },
        geometry,
      );
    },
  },
  "block-repeat": {
    prepare(operation, geometry) {
      if (operation.kind !== "block-repeat") return invalidOperation();
      return validCommand(
        {
          kind: "repeat-block",
          componentIndex: operation.componentIndex,
          sourceX: operation.sourceX,
          sourceY: operation.sourceY,
          offsetX: operation.offsetX,
          offsetY: operation.offsetY,
          repetitions: operation.repetitions,
        },
        geometry,
      );
    },
  },
  "block-permutation": {
    prepare(operation, geometry) {
      if (operation.kind !== "block-permutation") return invalidOperation();
      return validCommand(
        {
          kind: "permute-blocks",
          componentIndex: operation.componentIndex,
          mask: operation.mask,
          seed: operation.seed,
        },
        geometry,
      );
    },
  },
  "block-shift": {
    prepare(operation, geometry) {
      if (operation.kind !== "block-shift") return invalidOperation();
      return validCommand(
        {
          kind: "shift-blocks",
          componentIndex: operation.componentIndex,
          mask: operation.mask,
          offsetX: operation.offsetX,
          offsetY: operation.offsetY,
        },
        geometry,
      );
    },
  },
  "block-transfer": {
    prepare(operation, geometry) {
      if (operation.kind !== "block-transfer") return invalidOperation();
      return validCommand(
        {
          kind: "transfer-blocks",
          componentIndex: operation.componentIndex,
          sourceX: operation.sourceX,
          sourceY: operation.sourceY,
          width: operation.width,
          height: operation.height,
          destinationX: operation.destinationX,
          destinationY: operation.destinationY,
          mode: BLOCK_TRANSFER_MODE_INDEX[operation.mode],
          action: BLOCK_TRANSFER_ACTION_INDEX[operation.action],
        },
        geometry,
      );
    },
  },
  quantization: {
    prepare(operation, geometry) {
      if (operation.kind !== "quantization") return invalidOperation();
      return validCommand(
        {
          kind: "set-quantization",
          tableId: operation.tableId,
          semantics: QUANTIZATION_SEMANTICS_INDEX[operation.semantics],
          values: Uint8Array.from(operation.values),
        },
        geometry,
      );
    },
  },
};

export function compileCodecCommands(
  operations: readonly JpegGlitchOperation[],
  geometry: JpegBlockGeometry,
): Result<readonly CodecOperationCommand[]> {
  if (operations.length > MAX_GLITCH_OPERATIONS) {
    return invalidOperation();
  }
  const commands: CodecOperationCommand[] = [];
  for (const operation of operations) {
    const result = operationStrategies[operation.kind].prepare(
      operation,
      geometry,
    );
    if (!result.ok) return result;
    commands.push(result.value);
  }
  if (!isBoundedCodecWork(geometry, commands)) {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "This JPEG glitch preview exceeds the worker's bounded processing limit. Use a smaller image or fewer operations.",
    });
  }
  return { ok: true, value: Object.freeze(commands) };
}

export function isCodecCommand(
  value: unknown,
  geometry: JpegBlockGeometry,
): value is CodecOperationCommand {
  return isRegisteredCodecCommand(value, geometry);
}

export function isCodecCommandList(
  value: unknown,
  geometry: JpegBlockGeometry,
): value is readonly CodecOperationCommand[] {
  return (
    Array.isArray(value) &&
    value.every((command: unknown) => isCodecCommand(command, geometry))
  );
}

export function isBoundedCodecWork(
  geometry: JpegBlockGeometry,
  commands: readonly CodecOperationCommand[],
): boolean {
  return (
    commands.reduce(
      (total, command) => total + getCodecCommandWorkSize(geometry, command),
      0,
    ) <= MAX_EDITED_BLOCKS
  );
}

export function isJpegBlockGeometry(
  value: unknown,
): value is JpegBlockGeometry {
  if (typeof value !== "object" || value === null) return false;
  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");
  const components: unknown = Reflect.get(value, "components");
  if (
    !isInteger(width) ||
    width <= 0 ||
    !isInteger(height) ||
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

function validCommand(
  command: CodecOperationCommand,
  geometry: JpegBlockGeometry,
): Result<CodecOperationCommand> {
  return isCodecCommand(command, geometry)
    ? { ok: true, value: command }
    : invalidOperation();
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function invalidOperation(): Result<never> {
  return failure({
    code: "INVALID_INPUT",
    message: "The JPEG operation or its compiled codec command is invalid.",
  });
}
