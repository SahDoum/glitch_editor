import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import {
  getJpegComponentBlockGrid,
  type JpegBlockGeometry,
} from "../block-geometry";
import { failure, type Result } from "../../shared/result";
import { CodecOperationController } from "./controller";

export class SetQuantizationController extends CodecOperationController {
  readonly kind = "set-quantization";

  isCodecCommand(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is CodecOperationCommand {
    if (!this.isRecord(value) || value.kind !== this.kind) return false;
    const { tableId, semantics, values } = value;
    return (
      this.isInteger(tableId) &&
      tableId >= 0 &&
      tableId <= 3 &&
      geometry.components.some(
        (component) => component.quantizationTable === tableId,
      ) &&
      this.isInteger(semantics) &&
      semantics >= 0 &&
      semantics <= 1 &&
      values instanceof Uint8Array &&
      values.length === 64 &&
      values.every((entry) => entry >= 1 && entry <= 255)
    );
  }

  getWorkSize(
    geometry: JpegBlockGeometry,
    command: CodecOperationCommand,
  ): number {
    if (
      !this.isCodecCommand(command, geometry) ||
      command.kind !== this.kind ||
      command.semantics === 0
    ) {
      return 0;
    }
    return geometry.components.reduce((total, component) => {
      if (component.quantizationTable !== command.tableId) return total;
      const grid = getJpegComponentBlockGrid(geometry, component.id);
      return total + (grid ? grid.columns * grid.rows : 0);
    }, 0);
  }

  handleOperation(
    codec: CodecCommandModule,
    command: CodecOperationCommand,
    geometry: JpegBlockGeometry,
  ): Result<number> {
    if (command.kind !== this.kind) {
      return failure({
        code: "INVALID_INPUT",
        message: "The quantization controller received an unsupported command.",
      });
    }
    if (
      !geometry.components.some(
        (component) => component.quantizationTable === command.tableId,
      )
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG quantization table is not in use.",
      });
    }
    return this.withWasmMemory(codec, command.values, (pointer) =>
      codec._coefficient_set_quantization(
        command.tableId,
        command.semantics,
        pointer,
        command.values.byteLength,
      ),
    );
  }
}
