import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import type { JpegBlockGeometry } from "../block-geometry";
import { failure, success, type Result } from "../../shared/result";
import { CodecOperationController } from "./controller";

export class RepeatBlockController extends CodecOperationController {
  readonly kind = "repeat-block";

  isCodecCommand(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is CodecOperationCommand {
    if (!this.isRecord(value) || value.kind !== this.kind) return false;
    const { componentIndex, sourceX, sourceY, offsetX, offsetY, repetitions } =
      value;
    const grid = this.getGrid(geometry, componentIndex);
    if (
      !grid ||
      !this.isInteger(sourceX) ||
      !this.isInteger(sourceY) ||
      !this.isInteger(offsetX) ||
      !this.isInteger(offsetY) ||
      !this.isInteger(repetitions) ||
      (offsetX === 0 && offsetY === 0) ||
      Math.abs(offsetX) > 256 ||
      Math.abs(offsetY) > 256 ||
      repetitions < 1 ||
      repetitions > 256 ||
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

  getWorkSize(
    geometry: JpegBlockGeometry,
    command: CodecOperationCommand,
  ): number {
    return this.isCodecCommand(command, geometry) && command.kind === this.kind
      ? command.repetitions
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
        message: "The repeat controller received an unsupported command.",
      });
    }
    if (!geometry.components[command.componentIndex]) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG component is invalid.",
      });
    }
    return success(
      codec._coefficient_repeat_block(
        command.componentIndex,
        command.sourceX,
        command.sourceY,
        command.offsetX,
        command.offsetY,
        command.repetitions,
      ),
    );
  }
}
