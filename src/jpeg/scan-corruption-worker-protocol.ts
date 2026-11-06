import type { Result } from "../shared/result";
import type {
  ScanCorruptionParameters,
  ScanCorruptionReport,
} from "./scan-corruption";

export interface ScanCorruptionWorkerRequest {
  readonly id: number;
  readonly type: "corrupt";
  readonly bytes: ArrayBuffer;
  readonly stages: readonly ScanCorruptionParameters[];
}

export interface ScanDecodeDiagnostic {
  readonly decoder: "libjpeg-turbo";
  readonly status:
    "complete" | "warnings" | "incomplete" | "failed" | "unavailable";
  readonly decodedRows: number;
  readonly expectedRows: number;
  readonly warningCount: number;
  readonly warningFlags: number;
  readonly message: string;
}

export type ScanCorruptionWorkerResponse = {
  readonly id: number;
  readonly result: Result<{
    readonly type: "corrupted";
    readonly bytes: ArrayBuffer;
    readonly reports: readonly ScanCorruptionReport[];
    readonly diagnostic: ScanDecodeDiagnostic;
  }>;
};
