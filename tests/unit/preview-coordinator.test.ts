import { describe, expect, it } from "vitest";
import { PreviewCoordinator } from "../../src/application/preview-coordinator";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: (value: Value) => resolve(value) };
}

describe("preview result coordination", () => {
  it("discards older results after a newer preview request", async () => {
    const coordinator = new PreviewCoordinator();
    const oldWork = deferred<string>();
    let revision = 1;
    const oldRequest = coordinator.run(
      1,
      () => revision,
      () => oldWork.promise,
    );
    revision = 2;
    const currentRequest = coordinator.run(
      2,
      () => revision,
      async () => "current preview",
    );

    expect(await currentRequest).toEqual({
      status: "current",
      documentRevision: 2,
      value: "current preview",
    });
    oldWork.resolve("stale preview");
    expect(await oldRequest).toEqual({
      status: "stale",
      documentRevision: 1,
    });
  });

  it("discards results whose document revision has changed", async () => {
    const coordinator = new PreviewCoordinator();
    const work = deferred<number>();
    let revision = 4;
    const request = coordinator.run(
      4,
      () => revision,
      () => work.promise,
    );
    revision = 5;
    work.resolve(99);

    await expect(request).resolves.toEqual({
      status: "stale",
      documentRevision: 4,
    });
  });

  it("does not swallow computation failures", async () => {
    const coordinator = new PreviewCoordinator();
    await expect(
      coordinator.run(
        0,
        () => 0,
        async () => {
          throw new Error("preview failed");
        },
      ),
    ).rejects.toThrow("preview failed");
  });
});
