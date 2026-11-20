import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJgeProjectFile } from "../../src/project/project-file";

class ProjectWorker {
  static latest: ProjectWorker;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    ProjectWorker.latest = this;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

beforeEach(() => vi.stubGlobal("Worker", ProjectWorker));
afterEach(() => vi.unstubAllGlobals());

describe("project worker protocol", () => {
  it("forwards progress and settles once, ignoring saved late handlers", async () => {
    const progress = vi.fn();
    const promise = readJgeProjectFile(
      new File(["{}"], "test.jpglitch"),
      progress,
    );
    const worker = ProjectWorker.latest;
    expect(worker.postMessage).toHaveBeenCalledWith({ file: expect.any(File) });
    const lateHandler = worker.onmessage!;
    worker.emit({ type: "progress", progress: "Reading project…" });
    worker.emit({ type: "progress", progress: "Verifying project…" });
    worker.emit({
      type: "result",
      result: {
        ok: false,
        error: { code: "INVALID_INPUT", message: "Invalid project." },
      },
    });
    expect(await promise).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    lateHandler({
      data: { type: "progress", progress: "late" },
    } as MessageEvent<unknown>);
    expect(progress.mock.calls).toEqual([
      ["Reading project…"],
      ["Verifying project…"],
    ]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it.each([
    null,
    { type: "result" },
    { type: "result", result: { ok: true, value: {} } },
    {
      type: "result",
      result: { ok: false, error: { code: "BOGUS", message: "bad" } },
    },
    { type: "progress", progress: "loading", result: { ok: true, value: {} } },
    { type: "progress", progress: 42 },
    {
      type: "result",
      progress: "loading",
      result: { ok: false, error: { code: "INVALID_INPUT", message: "bad" } },
    },
  ])(
    "rejects malformed response %j without leaving a pending request",
    async (response) => {
      const promise = readJgeProjectFile(new File(["{}"], "test.jpglitch"));
      ProjectWorker.latest.emit(response);
      expect(await promise).toMatchObject({
        ok: false,
        error: { code: "PROCESSING_FAILED" },
      });
      expect(ProjectWorker.latest.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels in-flight loading and releases listeners", async () => {
    const abort = new AbortController();
    const promise = readJgeProjectFile(
      new File(["{}"], "test.jpglitch"),
      undefined,
      abort.signal,
    );
    abort.abort();
    expect(await promise).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(ProjectWorker.latest.terminate).toHaveBeenCalledTimes(1);
    expect(ProjectWorker.latest.onmessage).toBeNull();
  });
});
