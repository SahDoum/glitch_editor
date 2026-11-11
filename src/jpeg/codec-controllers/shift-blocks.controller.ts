import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import type { JpegBlockGeometry } from "../block-geometry";
import { failure, type Result } from "../../shared/result";
import { CodecOperationController } from "./controller";

export class ShiftBlocksController extends CodecOperationController {
  readonly kind = "shift-blocks";

  isCodecCommand(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is CodecOperationCommand {
    if (!this.isRecord(value) || value.kind !== this.kind) return false;
    const { componentIndex, mask, offsetX, offsetY } = value;
    return (
      this.getGrid(geometry, componentIndex) !== null &&
      this.isInteger(offsetX) &&
      Math.abs(offsetX) <= 256 &&
      this.isInteger(offsetY) &&
      Math.abs(offsetY) <= 256 &&
      (offsetX !== 0 || offsetY !== 0) &&
      this.isValidMask(mask, geometry)
    );
  }

  getWorkSize(
    geometry: JpegBlockGeometry,
    command: CodecOperationCommand,
  ): number {
    if (!this.isCodecCommand(command, geometry) || command.kind !== this.kind) {
      return 0;
    }
    const grid = this.getGrid(geometry, command.componentIndex);
    return grid ? grid.columns * grid.rows : 0;
  }

  handleOperation(
    codec: CodecCommandModule,
    command: CodecOperationCommand,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (command.kind !== this.kind) {
      return failure({
        code: "INVALID_INPUT",
        message: "The shift controller received an unsupported command.",
      });
    }
    return this.withComponentMask(
      codec,
      geometry,
      command.componentIndex,
      command.mask,
      true,
      (pointer, size) =>
        codec._coefficient_shift_blocks(
          command.componentIndex,
          pointer,
          size,
          command.offsetX,
          command.offsetY,
        ),
    );
  }
}
