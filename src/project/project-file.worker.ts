import { failure } from "../shared/result";
import { readJgeProjectText } from "./project-file";

interface ProjectReadWorkerRequest {
  readonly id: number;
  readonly file: File;
}

const workerScope = self as typeof self & {
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

function isProjectReadRequest(
  value: unknown,
): value is ProjectReadWorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    value.id === 0 &&
    "file" in value &&
    value.file instanceof File
  );
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void (async () => {
    if (!isProjectReadRequest(event.data)) {
      workerScope.postMessage({
        id: 0,
        result: failure({
          code: "INVALID_INPUT",
          message: "The project loading request was invalid.",
        }),
      });
      return;
    }

    workerScope.postMessage({
      id: event.data.id,
      progress: "Reading project…",
    });
    let serialized: string;
    try {
      serialized = await event.data.file.text();
    } catch {
      workerScope.postMessage({
        id: event.data.id,
        result: failure({
          code: "PROCESSING_FAILED",
          message: "The selected project file could not be read.",
        }),
      });
      return;
    }

    workerScope.postMessage({
      id: event.data.id,
      progress: "Verifying project…",
    });
    const result = await readJgeProjectText(serialized);
    if (!result.ok) {
      workerScope.postMessage({ id: event.data.id, result });
      return;
    }
    const bytes = result.value.source.bytes;
    workerScope.postMessage({ id: event.data.id, result }, [bytes.buffer]);
  })();
});
