import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import {
  getMaskBlockCoverage,
  getMaskBlockCoverageAtLeastHalf,
  getJpegComponentBlockGrid,
  type JpegBlockGeometry,
} from "../block-geometry";
import { isSpatialMask, type SpatialMask } from "../../document/masks";
import { failure, success, type Result } from "../../shared/result";

export abstract class CodecOperationController {
  abstract readonly kind: CodecOperationCommand["kind"];

  abstract isCodecCommand(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is CodecOperationCommand;

  abstract getWorkSize(
    geometry: JpegBlockGeometry,
    command: CodecOperationCommand,
  ): number;

  abstract handleOperation(
    codec: CodecCommandModule,
    command: CodecOperationCommand,
    geometry: JpegBlockGeometry,
  ): Result<number>;

  protected isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  protected isInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
  }

  protected getGrid(geometry: JpegBlockGeometry, componentIndex: unknown) {
    if (
      !this.isInteger(componentIndex) ||
      componentIndex < 0 ||
      componentIndex >= geometry.components.length
    ) {
      return null;
    }
    const component = geometry.components[componentIndex];
    return component ? getJpegComponentBlockGrid(geometry, component.id) : null;
  }

  protected isValidMask(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is SpatialMask {
    return (
      isSpatialMask(value) &&
      value.width === geometry.width &&
      value.height === geometry.height
    );
  }

  protected withWasmMemory(
    codec: CodecCommandModule,
    bytes: Uint8Array,
    execute: (pointer: number) => number,
  ): Result<number> {
    if (bytes.byteLength === 0) {
      return failure({
        code: "INVALID_INPUT",
        message: "The JPEG codec command has an empty input buffer.",
      });
    }
    const pointer = codec._malloc(bytes.byteLength);
    if (!Number.isSafeInteger(pointer) || pointer <= 0) {
      return failure({
        code: "PROCESSING_FAILED",
        message:
          "There was not enough memory to prepare the JPEG codec command.",
      });
    }
    if (pointer + bytes.byteLength > codec.HEAPU8.byteLength) {
      codec._free(pointer);
      return failure({
        code: "PROCESSING_FAILED",
        message: "The JPEG codec command buffer is outside WebAssembly memory.",
      });
    }
    try {
      codec.HEAPU8.set(bytes, pointer);
      return success(execute(pointer));
    } finally {
      codec._free(pointer);
    }
  }

  protected withComponentMask(
    codec: CodecCommandModule,
    geometry: JpegBlockGeometry,
    componentIndex: number,
    mask: SpatialMask,
    atLeastHalf: boolean,
    execute: (pointer: number, size: number) => number,
  ): Result<number> {
    const component = geometry.components[componentIndex];
    if (!component) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG component is invalid.",
      });
    }
    const coverage = atLeastHalf
      ? getMaskBlockCoverageAtLeastHalf(mask, geometry, component.id)
      : getMaskBlockCoverage(mask, geometry, component.id);
    if (!coverage.ok) return coverage;
    return this.withWasmMemory(codec, coverage.value, (pointer) =>
      execute(pointer, coverage.value.byteLength),
    );
  }
}
