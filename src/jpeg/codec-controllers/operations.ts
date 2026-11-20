import type { JpegBlockGeometry } from "../block-geometry";
import { getJpegComponentBlockGrid } from "../block-geometry";
import {
  isBlockPermutationParameters,
  isBlockRepeatParameters,
  isBlockShiftParameters,
  isBlockTransferParameters,
  isCoefficientGlitchParameters,
  isQuantizationParameters,
  type JpegGlitchOperation,
} from "../../operations/jpeg-glitch";
import { failure, success, type Result } from "../../shared/result";
import { OperationController, type CodecCommandModule } from "./controller";

const modes = {
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
const domains = { ac: 0, dc: 1 } as const;
const bands = { low: 0, mid: 1, high: 2, all: 3 } as const;
const transferModes = { all: 0, dc: 1, ac: 2 } as const;
const transferActions = { copy: 0, swap: 1 } as const;
const semantics = { reinterpret: 0, requantize: 1 } as const;

function invalid(): Result<number> {
  return failure({
    code: "INVALID_INPUT",
    message: "Invalid JPEG operation parameters.",
  });
}

function gridSize(geometry: JpegBlockGeometry, componentIndex: number): number {
  const component = geometry.components[componentIndex];
  const grid = component && getJpegComponentBlockGrid(geometry, component.id);
  return grid ? grid.columns * grid.rows : 0;
}

class CoefficientsController extends OperationController {
  readonly kind = "coefficients" as const;
  isOperation(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is Extract<JpegGlitchOperation, { kind: "coefficients" }> {
    return (
      isCoefficientGlitchParameters(value, geometry) &&
      gridSize(geometry, value.componentIndex) > 0
    );
  }
  getWorkSize(
    geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number {
    return operation.kind === this.kind
      ? gridSize(geometry, operation.componentIndex)
      : 0;
  }
  apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (!this.isOperation(operation, geometry)) return invalid();
    return this.withComponentMask(
      codec,
      geometry,
      operation.componentIndex,
      operation.mask,
      "any-intersection",
      (pointer, size) =>
        codec._coefficient_apply(
          operation.componentIndex,
          modes[operation.mode],
          domains[operation.domain],
          bands[operation.frequencyBand],
          pointer,
          size,
          operation.strength,
          operation.seed,
        ),
    );
  }
}

class RepeatController extends OperationController {
  readonly kind = "block-repeat" as const;
  isOperation = isBlockRepeatParameters;
  getWorkSize(
    _geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number {
    return operation.kind === this.kind ? operation.repetitions : 0;
  }
  apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (!this.isOperation(operation, geometry)) return invalid();
    return success(
      codec._coefficient_repeat_block(
        operation.componentIndex,
        operation.sourceX,
        operation.sourceY,
        operation.offsetX,
        operation.offsetY,
        operation.repetitions,
      ),
    );
  }
}

class PermutationController extends OperationController {
  readonly kind = "block-permutation" as const;
  isOperation(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is Extract<JpegGlitchOperation, { kind: "block-permutation" }> {
    return (
      isBlockPermutationParameters(value, geometry) &&
      gridSize(geometry, value.componentIndex) > 0
    );
  }
  getWorkSize(
    geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number {
    return operation.kind === this.kind
      ? gridSize(geometry, operation.componentIndex)
      : 0;
  }
  apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (!this.isOperation(operation, geometry)) return invalid();
    return this.withComponentMask(
      codec,
      geometry,
      operation.componentIndex,
      operation.mask,
      "at-least-half",
      (pointer, size) =>
        codec._coefficient_permute_blocks(
          operation.componentIndex,
          pointer,
          size,
          operation.seed,
        ),
    );
  }
}

class ShiftController extends OperationController {
  readonly kind = "block-shift" as const;
  isOperation(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is Extract<JpegGlitchOperation, { kind: "block-shift" }> {
    return (
      isBlockShiftParameters(value, geometry) &&
      gridSize(geometry, value.componentIndex) > 0
    );
  }
  getWorkSize(
    geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number {
    return operation.kind === this.kind
      ? gridSize(geometry, operation.componentIndex)
      : 0;
  }
  apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (!this.isOperation(operation, geometry)) return invalid();
    return this.withComponentMask(
      codec,
      geometry,
      operation.componentIndex,
      operation.mask,
      "at-least-half",
      (pointer, size) =>
        codec._coefficient_shift_blocks(
          operation.componentIndex,
          pointer,
          size,
          operation.offsetX,
          operation.offsetY,
        ),
    );
  }
}

class TransferController extends OperationController {
  readonly kind = "block-transfer" as const;
  isOperation = isBlockTransferParameters;
  getWorkSize(
    _geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number {
    return operation.kind === this.kind
      ? operation.width * operation.height * 2
      : 0;
  }
  apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (!this.isOperation(operation, geometry)) return invalid();
    return success(
      codec._coefficient_transfer_blocks(
        operation.componentIndex,
        operation.sourceX,
        operation.sourceY,
        operation.width,
        operation.height,
        operation.destinationX,
        operation.destinationY,
        transferModes[operation.mode],
        transferActions[operation.action],
      ),
    );
  }
}

class QuantizationController extends OperationController {
  readonly kind = "quantization" as const;
  isOperation(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is Extract<JpegGlitchOperation, { kind: "quantization" }> {
    return isQuantizationParameters(value, geometry);
  }
  getWorkSize(
    geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number {
    if (operation.kind !== this.kind || operation.semantics === "reinterpret")
      return 0;
    return geometry.components.reduce(
      (total, component, index) =>
        total +
        (component.quantizationTable === operation.tableId
          ? gridSize(geometry, index)
          : 0),
      0,
    );
  }
  apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (!this.isOperation(operation, geometry)) return invalid();
    const values = Uint8Array.from(operation.values);
    return this.withWasmMemory(codec, values, (pointer) =>
      codec._coefficient_set_quantization(
        operation.tableId,
        semantics[operation.semantics],
        pointer,
        values.byteLength,
      ),
    );
  }
}

export const coefficientOperation = new CoefficientsController();
export const blockRepeatOperation = new RepeatController();
export const blockPermutationOperation = new PermutationController();
export const blockShiftOperation = new ShiftController();
export const blockTransferOperation = new TransferController();
export const quantizationOperation = new QuantizationController();
