import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import type { JpegBlockGeometry } from "../block-geometry";
import type { Result } from "../../shared/result";
import type { CodecOperationController } from "./controller";
import { ApplyCoefficientsController } from "./apply-coefficients.controller";
import { PermuteBlocksController } from "./permute-blocks.controller";
import { RepeatBlockController } from "./repeat-block.controller";
import { SetQuantizationController } from "./set-quantization.controller";
import { ShiftBlocksController } from "./shift-blocks.controller";
import { TransferBlocksController } from "./transfer-blocks.controller";

const controllers = {
  "apply-coefficients": new ApplyCoefficientsController(),
  "repeat-block": new RepeatBlockController(),
  "permute-blocks": new PermuteBlocksController(),
  "shift-blocks": new ShiftBlocksController(),
  "transfer-blocks": new TransferBlocksController(),
  "set-quantization": new SetQuantizationController(),
} satisfies Record<CodecOperationCommand["kind"], CodecOperationController>;

export function handleCodecOperation(
  codec: CodecCommandModule,
  command: CodecOperationCommand,
  geometry: JpegBlockGeometry,
): Result<number> {
  return controllers[command.kind].handleOperation(codec, command, geometry);
}

export function isRegisteredCodecCommand(
  value: unknown,
  geometry: JpegBlockGeometry,
): value is CodecOperationCommand {
  if (typeof value !== "object" || value === null) return false;
  const kind = Reflect.get(value, "kind");
  return (
    isCodecOperationKind(kind) &&
    controllers[kind].isCodecCommand(value, geometry)
  );
}

export function getCodecCommandWorkSize(
  geometry: JpegBlockGeometry,
  command: CodecOperationCommand,
): number {
  return controllers[command.kind].getWorkSize(geometry, command);
}

function isCodecOperationKind(
  value: unknown,
): value is CodecOperationCommand["kind"] {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(controllers, value)
  );
}
