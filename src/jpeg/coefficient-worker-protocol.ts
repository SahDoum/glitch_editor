import type { Result } from "../shared/result";
import type { JpegGlitchOperation } from "../operations/jpeg-glitch";
import type { JpegBlockGeometry } from "./block-geometry";
import type { EncodeOptions } from "./encode-options";
import { isJpegOutputMode } from "./encode-options";
import {
  isJpegBlockGeometry,
  isOperationList,
} from "./codec-controllers/registry";

export const MAX_JPEG_BYTES = 50 * 1024 * 1024;

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
      operations: readonly JpegGlitchOperation[];
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

export function isCoefficientWorkerRequest(
  value: unknown,
): value is CoefficientWorkerRequest {
  if (typeof value !== "object" || value === null || !("id" in value))
    return false;
  if (typeof value.id !== "number" || !Number.isInteger(value.id)) return false;
  if (!("type" in value)) return false;
  if (value.type === "open") {
    return (
      "bytes" in value &&
      value.bytes instanceof ArrayBuffer &&
      value.bytes.byteLength > 0 &&
      value.bytes.byteLength <= MAX_JPEG_BYTES
    );
  }
  if (value.type === "read-block") {
    return (
      "componentIndex" in value &&
      Number.isInteger(value.componentIndex) &&
      "blockX" in value &&
      Number.isInteger(value.blockX) &&
      "blockY" in value &&
      Number.isInteger(value.blockY)
    );
  }
  if (value.type !== "encode") return false;
  const geometry: unknown = Reflect.get(value, "geometry");
  const operations: unknown = Reflect.get(value, "operations");
  const bytes: unknown = Reflect.get(value, "bytes");
  const options: unknown = Reflect.get(value, "options");
  return (
    typeof options === "object" &&
    options !== null &&
    isJpegOutputMode(Reflect.get(options, "mode")) &&
    bytes instanceof ArrayBuffer &&
    bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_JPEG_BYTES &&
    isJpegBlockGeometry(geometry) &&
    isOperationList(operations, geometry)
  );
}
