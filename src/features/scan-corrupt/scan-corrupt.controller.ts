import { corruptEncodedJpeg } from "../../application/scan-corruption";
import type {
  ScanCorruptionParameters,
  ScanCorruptionReport,
} from "../../jpeg/scan-corruption";
import type { ScanCorruptionController } from "../effects/types";
import { ScanCorruptView, type ScanCorruptSettings } from "./scan-corrupt.view";

/**
 * Byte-domain controller: it exposes `execute_corrupt` and no `apply`, so it
 * can never be driven through the coefficient operation history.
 */
export class ScanCorruptController implements ScanCorruptionController<ScanCorruptSettings> {
  readonly view = ScanCorruptView;
  declare readonly apply?: never;
  declare readonly gestures?: never;

  toParameters(settings: ScanCorruptSettings): ScanCorruptionParameters {
    return {
      mode: settings.mode,
      count: settings.count,
      rangeStart: settings.rangeStart,
      rangeEnd: settings.rangeEnd,
      seed: settings.seed,
    };
  }

  settingsFromReport(report: ScanCorruptionReport): ScanCorruptSettings {
    return this.toParameters(report);
  }

  execute_corrupt(
    cleanEncodedBytes: Uint8Array,
    stages: readonly ScanCorruptionParameters[],
    signal?: AbortSignal,
  ) {
    return corruptEncodedJpeg(cleanEncodedBytes, stages, signal);
  }
}

export const ScanCorruptEffect = new ScanCorruptController();
