import type { Result } from "../shared/result";
import type { CodecOperationCommand } from "./codec-command-dispatcher";
import type { JpegBlockGeometry } from "./block-geometry";
import type { EncodeOptions } from "./encode-options";

export type CoefficientWorkerRequest =
  | {
      id: number;
      type: "open";
      bytes: ArrayBuffer;
    }
  | {
      id: number;
      type: "read-block";
      componentIndex: number;
      blockX: number;
      blockY: number;
    }
  | {
      id: number;
      type: "encode";
      bytes: ArrayBuffer;
      geometry: JpegBlockGeometry;
      commands: readonly CodecOperationCommand[];
      options: EncodeOptions;
    };

export type CoefficientWorkerValue =
  | { type: "opened" }
  | { type: "block"; values: number[] }
  | { type: "encoded"; bytes: ArrayBuffer };

export interface CoefficientWorkerResponse {
  id: number;
  result: Result<CoefficientWorkerValue>;
}
