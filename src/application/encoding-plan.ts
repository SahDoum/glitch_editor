import type { JpegGlitchOperation } from "../operations/jpeg-glitch";
import { failure, type Result } from "../shared/result";

export function encodingPlanKey(
  operations: readonly JpegGlitchOperation[],
): string {
  return JSON.stringify(operations, (key, value: unknown) => {
    // A mask's identity is history metadata; only its geometry affects encoding.
    if (key === "id") return undefined;
    return value;
  });
}

/** Keeps semantic plan identity stable when history-only metadata changes. */
export class EncodingPlanIdentity {
  private key: string | null = null;
  private operations: readonly JpegGlitchOperation[] = [];

  resolve(
    operations: readonly JpegGlitchOperation[],
  ): readonly JpegGlitchOperation[] {
    const key = encodingPlanKey(operations);
    if (key !== this.key) {
      this.key = key;
      this.operations = operations;
    }
    return this.operations;
  }
}

interface Entry {
  readonly controller: AbortController;
  readonly promise: Promise<Result<Uint8Array>>;
  consumers: number;
  settled: boolean;
}

const cancelled = (): Result<Uint8Array> =>
  failure({
    code: "CANCELLED",
    message: "JPEG encoding cancelled.",
  });

/** Two byte results per source: committed plan and current draft. URLs are never cached. */
export class EncodingPlanCache {
  private source: object | null = null;
  private committedKey: string | null = null;
  private readonly entries = new Map<string, Entry>();

  clear(): void {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
    this.source = null;
    this.committedKey = null;
  }

  keepCommitted(source: object | null, key: string): void {
    if (source !== this.source) {
      this.clear();
      this.source = source;
    }
    this.committedKey = key;
  }

  run(
    source: object,
    key: string,
    signal: AbortSignal,
    compute: (signal: AbortSignal) => Promise<Result<Uint8Array>>,
  ): Promise<Result<Uint8Array>> {
    if (signal.aborted) return Promise.resolve(cancelled());
    if (this.source !== source) {
      this.clear();
      this.source = source;
    }
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Entry = {
        controller,
        consumers: 0,
        settled: false,
        promise: Promise.resolve().then(() => compute(controller.signal)),
      };
      entry = created;
      this.entries.set(key, entry);
      void entry.promise.then(
        (result) => {
          created.settled = true;
          if (!result.ok && this.entries.get(key) === created)
            this.entries.delete(key);
        },
        () => {
          created.settled = true;
          if (this.entries.get(key) === created) this.entries.delete(key);
        },
      );
      while (this.entries.size > 2) {
        const oldest = [...this.entries].find(
          ([candidate]) => candidate !== this.committedKey,
        );
        if (!oldest) break;
        oldest[1].controller.abort();
        this.entries.delete(oldest[0]);
      }
    }
    const current = entry;
    current.consumers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (result?: Result<Uint8Array>, error?: unknown) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        current.consumers--;
        // A same-turn Preview → Apply handoff may attach its consumer here.
        queueMicrotask(() => {
          if (!current.settled && current.consumers === 0) {
            current.controller.abort();
            if (this.entries.get(key) === current) this.entries.delete(key);
          }
        });
        if (result) resolve(result);
        else reject(error);
      };
      const onAbort = () => finish(cancelled());
      signal.addEventListener("abort", onAbort, { once: true });
      void current.promise.then(
        (result) => finish(signal.aborted ? cancelled() : result),
        (error: unknown) => finish(undefined, error),
      );
    });
  }
}
