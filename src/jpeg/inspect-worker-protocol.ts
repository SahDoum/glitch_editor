import type { JpegInspection } from "./inspect";
import type { Result } from "../shared/result";

export interface InspectWorkerRequest {
  type: "inspect";
  bytes: ArrayBuffer;
}

export interface InspectWorkerResponse {
  result: Result<JpegInspection>;
}
