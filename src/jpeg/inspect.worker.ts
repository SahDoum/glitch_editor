import { failure } from "../shared/result";
import type {
  InspectWorkerRequest,
  InspectWorkerResponse,
} from "./inspect-worker-protocol";
import { inspectJpeg } from "./inspect";

const workerScope = self as typeof self & {
  postMessage(message: InspectWorkerResponse): void;
};

function isInspectRequest(value: unknown): value is InspectWorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "inspect" &&
    "bytes" in value &&
    value.bytes instanceof ArrayBuffer
  );
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isInspectRequest(event.data)) {
    workerScope.postMessage({
      result: failure({
        code: "INVALID_INPUT",
        message: "The JPEG inspection request was invalid.",
      }),
    });
    return;
  }

  workerScope.postMessage({
    result: inspectJpeg(new Uint8Array(event.data.bytes)),
  });
});
