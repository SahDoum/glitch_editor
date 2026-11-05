import type { Result } from "../shared/result";
import type { SpatialMask } from "../document/masks";
import type { DctFrequencyBand } from "../operations/dct";
import type { JpegBlockGeometry } from "./block-geometry";

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
      edits: readonly {
        componentIndex: number;
        frequencyBand: DctFrequencyBand;
        mask: SpatialMask;
      }[];
    };

export type CoefficientWorkerValue =
  | { type: "opened" }
  | { type: "block"; values: number[] }
  | { type: "encoded"; bytes: ArrayBuffer };

export interface CoefficientWorkerResponse {
  id: number;
  result: Result<CoefficientWorkerValue>;
}
