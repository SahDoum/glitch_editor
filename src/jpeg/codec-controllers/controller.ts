import type createLibjpegCoefficients from "../codec/libjpeg-coefficients.js";
import type { JpegGlitchOperation } from "../../operations/jpeg-glitch";
import {
  getMaskBlockCoverage,
  type MaskCoveragePolicy,
  type JpegBlockGeometry,
} from "../block-geometry";
import type { SpatialMask } from "../../document/masks";
import { failure, success, type Result } from "../../shared/result";

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

export abstract class OperationController<
  Kind extends JpegGlitchOperation["kind"] = JpegGlitchOperation["kind"],
> {
  abstract readonly kind: Kind;

  abstract isOperation(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is JpegGlitchOperation;

  abstract getWorkSize(
    geometry: JpegBlockGeometry,
    operation: JpegGlitchOperation,
  ): number;

  abstract apply(
    codec: CodecCommandModule,
    operation: JpegGlitchOperation,
    geometry: JpegBlockGeometry,
  ): Result<number>;

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
    policy: MaskCoveragePolicy,
    execute: (pointer: number, size: number) => number,
  ): Result<number> {
    const component = geometry.components[componentIndex];
    if (!component) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG component is invalid.",
      });
    }
    const coverage = getMaskBlockCoverage(mask, geometry, component.id, policy);
    if (!coverage.ok) return coverage;
    return this.withWasmMemory(codec, coverage.value, (pointer) =>
      execute(pointer, coverage.value.byteLength),
    );
  }
}
