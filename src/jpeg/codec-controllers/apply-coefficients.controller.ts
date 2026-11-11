import type {
  CodecCommandModule,
  CodecOperationCommand,
} from "../codec-command-dispatcher";
import type { JpegBlockGeometry } from "../block-geometry";
import { failure, type Result } from "../../shared/result";
import { CodecOperationController } from "./controller";

export class ApplyCoefficientsController extends CodecOperationController {
  readonly kind = "apply-coefficients";

  isCodecCommand(
    value: unknown,
    geometry: JpegBlockGeometry,
  ): value is CodecOperationCommand {
    if (!this.isRecord(value) || value.kind !== this.kind) return false;
    const {
      componentIndex,
      mode,
      domain,
      frequencyBand,
      strength,
      seed,
      mask,
    } = value;
    return (
      this.getGrid(geometry, componentIndex) !== null &&
      this.isInteger(mode) &&
      mode >= 0 &&
      mode <= 10 &&
      this.isInteger(domain) &&
      domain >= 0 &&
      domain <= 1 &&
      this.isInteger(frequencyBand) &&
      frequencyBand >= 0 &&
      frequencyBand <= 3 &&
      typeof strength === "number" &&
      Number.isFinite(strength) &&
      this.isInteger(seed) &&
      seed >= 0 &&
      seed <= 0xffff_ffff &&
      this.isValidMask(mask, geometry) &&
      this.isValidCoefficientSettings(mode, domain, frequencyBand, strength)
    );
  }

  getWorkSize(
    geometry: JpegBlockGeometry,
    command: CodecOperationCommand,
  ): number {
    if (command.kind !== this.kind) return 0;
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
        message: "The coefficient controller received an unsupported command.",
      });
    }
    return this.withComponentMask(
      codec,
      geometry,
      command.componentIndex,
      command.mask,
      false,
      (pointer, size) =>
        codec._coefficient_apply(
          command.componentIndex,
          command.mode,
          command.domain,
          command.frequencyBand,
          pointer,
          size,
          command.strength,
          command.seed,
        ),
    );
  }

  private isValidCoefficientSettings(
    mode: number,
    domain: number,
    frequencyBand: number,
    strength: number,
  ): boolean {
    return (
      !(
        (domain === 0 && mode === 3) ||
        (domain === 1 && frequencyBand !== 3)
      ) &&
      !(mode === 1 && (strength < -8 || strength > 8)) &&
      !(
        mode === 2 &&
        (strength < 1 || strength > 2047 || !Number.isInteger(strength))
      ) &&
      !(
        mode === 3 &&
        (domain !== 1 ||
          strength < -2047 ||
          strength > 2047 ||
          !Number.isInteger(strength))
      ) &&
      !(
        mode === 6 &&
        (domain !== 1 ||
          strength < 1 ||
          strength > 512 ||
          !Number.isInteger(strength))
      ) &&
      !(
        mode === 7 &&
        (domain !== 0 ||
          frequencyBand !== 3 ||
          strength < 1 ||
          strength > 14 ||
          !Number.isInteger(strength))
      ) &&
      !(
        (mode === 8 || mode === 9 || mode === 10) &&
        (domain !== 0 || frequencyBand !== 3 || strength < 1 || strength > 8)
      ) &&
      !(
        (mode === 4 || mode === 5) &&
        (domain !== 0 || strength !== 0 || (mode === 5 && frequencyBand === 3))
      )
    );
  }
}
