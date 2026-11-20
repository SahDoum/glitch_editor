import { failure } from "../shared/result";
import { readJgeProjectText } from "./project-file";

import type {
  ProjectReadWorkerRequest,
  ProjectReadWorkerResponse,
} from "./project-worker-protocol";

const workerScope = self as typeof self & {
  postMessage(
    message: ProjectReadWorkerResponse,
    transfer?: Transferable[],
  ): void;
};

function isProjectReadRequest(
  value: unknown,
): value is ProjectReadWorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "file" in value &&
    value.file instanceof File
  );
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void (async () => {
    if (!isProjectReadRequest(event.data)) {
      workerScope.postMessage({
        type: "result",
        result: failure({
          code: "INVALID_INPUT",
          message: "The project loading request was invalid.",
        }),
      });
      return;
    }

    workerScope.postMessage({
      type: "progress",
      progress: "Reading project…",
    });
    let serialized: string;
    try {
      serialized = await event.data.file.text();
    } catch {
      workerScope.postMessage({
        type: "result",
        result: failure({
          code: "PROCESSING_FAILED",
          message: "The selected project file could not be read.",
        }),
      });
      return;
    }

    workerScope.postMessage({
      type: "progress",
      progress: "Verifying project…",
    });
    const result = await readJgeProjectText(serialized);
    if (!result.ok) {
      workerScope.postMessage({ type: "result", result });
      return;
    }
    const bytes = result.value.source.bytes;
    workerScope.postMessage({ type: "result", result }, [bytes.buffer]);
  })();
});
