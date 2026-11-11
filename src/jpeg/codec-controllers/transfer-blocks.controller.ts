import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import type { JpegBlockGeometry } from "../block-geometry";
import { failure, success, type Result } from "../../shared/result";
import { CodecOperationController } from "./controller";
import { MAX_BLOCK_TRANSFER_BLOCKS } from "../../operations/jpeg-glitch";

export class TransferBlocksController extends CodecOperationController {
  readonly kind = "transfer-blocks";

  isCodecCommand(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is CodecOperationCommand {
    if (!this.isRecord(value) || value.kind !== this.kind) return false;
    const {
      componentIndex,
      sourceX,
      sourceY,
      width,
      height,
      destinationX,
      destinationY,
      mode,
      action,
    } = value;
    const grid = this.getGrid(geometry, componentIndex);
    if (
      !grid ||
      !this.isInteger(sourceX) ||
      !this.isInteger(sourceY) ||
      !this.isInteger(width) ||
      !this.isInteger(height) ||
      !this.isInteger(destinationX) ||
      !this.isInteger(destinationY) ||
      !this.isInteger(mode) ||
      mode < 0 ||
      mode > 2 ||
      !this.isInteger(action) ||
      action < 0 ||
      action > 1 ||
      sourceX < 0 ||
      sourceY < 0 ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_BLOCK_TRANSFER_BLOCKS ||
      destinationX < 0 ||
      destinationY < 0 ||
      sourceX + width > grid.columns ||
      sourceY + height > grid.rows ||
      destinationX + width > grid.columns ||
      destinationY + height > grid.rows
    ) {
      return false;
    }
    const overlaps =
      sourceX < destinationX + width &&
      destinationX < sourceX + width &&
      sourceY < destinationY + height &&
      destinationY < sourceY + height;
    return (
      action !== 1 ||
      !overlaps ||
      (sourceX === destinationX && sourceY === destinationY)
    );
  }

  getWorkSize(
    geometry: JpegBlockGeometry,
    command: CodecOperationCommand,
  ): number {
    return this.isCodecCommand(command, geometry) && command.kind === this.kind
      ? command.width * command.height * 2
      : 0;
  }

  handleOperation(
    codec: CodecCommandModule,
    command: CodecOperationCommand,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (command.kind !== this.kind) {
      return failure({
        code: "INVALID_INPUT",
        message: "The transfer controller received an unsupported command.",
      });
    }
    if (!geometry.components[command.componentIndex]) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG component is invalid.",
      });
    }
    return success(
      codec._coefficient_transfer_blocks(
        command.componentIndex,
        command.sourceX,
        command.sourceY,
        command.width,
        command.height,
        command.destinationX,
        command.destinationY,
        command.mode,
        command.action,
      ),
    );
  }
}
