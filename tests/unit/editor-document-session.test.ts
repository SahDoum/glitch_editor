import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { EditorDocumentSession } from "../../src/application/editor-document-session";
import {
  createJpegDocumentSession,
  applyBlockRepeatOperation,
} from "../../src/application/jpeg-document";
import { OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";

async function editingSession() {
  const bytes = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
    ),
  );
  const asset = OriginalAsset.create({
    bytes,
    fileName: "test.jpg",
    sha256: "0".repeat(64),
  });
  const inspection = inspectJpeg(bytes);
  if (!asset.ok || !inspection.ok) throw new Error("fixture");
  const history = createJpegDocumentSession({
    originalAsset: asset.value,
    inspection: inspection.value,
  });
  if (!history.ok) throw new Error("history");
  const session = new EditorDocumentSession();
  session.open(history.value);
  return session;
}
const operation = {
  kind: "block-repeat" as const,
  componentIndex: 0,
  sourceX: 0,
  sourceY: 0,
  offsetX: 1,
  offsetY: 0,
  repetitions: 1,
};
const stage = {
  mode: "bit-flip" as const,
  count: 1,
  seed: 1,
  rangeStart: 0,
  rangeEnd: 1,
};

describe("editor document session", () => {
  it("rejects coefficient edits before mutation while terminal scan stages exist", async () => {
    const session = await editingSession();
    expect(
      session.mutate((history) => applyBlockRepeatOperation(history, operation))
        .ok,
    ).toBe(true);
    expect(session.scanHistory.record(stage).ok).toBe(true);
    const before = session.history?.snapshot;
    const mutate = vi.fn((history: NonNullable<typeof session.history>) =>
      history.delete("anything"),
    );
    expect(session.mutate(mutate)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(session.history?.snapshot).toBe(before);
    expect(session.scanHistory.activeStages).toHaveLength(1);
  });

  it("captures complete immutable edits and Reset clears the scan stages used by Save", async () => {
    const session = await editingSession();
    session.mutate((history) => applyBlockRepeatOperation(history, operation));
    session.scanHistory.record(stage);
    const saved = session.snapshotEdits(null);
    expect(session.reset().ok).toBe(true);
    const reset = session.snapshotEdits(null);
    expect(reset.operations).toEqual([]);
    expect(reset.scanCorruptionStages).toEqual([]);
    expect(saved.operations).toHaveLength(1);
    expect(saved.scanCorruptionStages).toEqual([stage]);
    expect(session.scanHistory.canRedo).toBe(false);
  });

  it("invalidates scan redo when the clean plan changes and clears it on a new document", async () => {
    const session = await editingSession();
    session.scanHistory.record(stage);
    expect(session.scanHistory.commitUndo()).toBe(true);
    expect(session.scanHistory.canRedo).toBe(true);
    expect(
      session.mutate((history) => applyBlockRepeatOperation(history, operation))
        .ok,
    ).toBe(true);
    expect(session.scanHistory.canRedo).toBe(false);
    session.scanHistory.record(stage);
    const next = await editingSession();
    session.open(next.history!);
    expect(session.snapshotEdits(null)).toMatchObject({
      operations: [],
      scanCorruptionStages: [],
    });
  });
  it("commits only the exact executed scan snapshot after success and rejects stale completion", async () => {
    const session = await editingSession();
    const mutable = { ...stage };
    const prepared = session.prepareScan(mutable);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    mutable.seed = 999;
    expect(session.scanHistory.activeStages).toEqual([]);
    expect(prepared.value.stages).toEqual([stage]);
    expect(prepared.value.commit()).toBe(true);
    expect(prepared.value.commit()).toBe(false);
    expect(session.snapshotEdits(null).scanCorruptionStages).toEqual([stage]);
    const update = session.prepareScan({ ...stage, seed: 2 }, true);
    expect(update.ok).toBe(true);
    session.reset();
    expect(update.ok && update.value.commit()).toBe(false);
    expect(session.scanHistory.activeStages).toEqual([]);
  });

  it("routes scan Undo/Redo through deferred commits before reaching coefficient history", async () => {
    const session = await editingSession();
    session.mutate((history) => applyBlockRepeatOperation(history, operation));
    session.restoreScanStages([stage, { ...stage, seed: 2 }]);
    const undo = session.undo();
    expect(undo?.kind).toBe("scan");
    expect(session.scanHistory.activeStages).toHaveLength(2);
    if (undo?.kind !== "scan") throw new Error("scan transition");
    expect(undo.transition.stages).toEqual([stage]);
    expect(undo.transition.commit()).toBe(true);
    const undoFirst = session.undo();
    if (undoFirst?.kind !== "scan") throw new Error("scan transition");
    expect(undoFirst.transition.stages).toEqual([]);
    expect(undoFirst.transition.commit()).toBe(true);
    const redoFirst = session.redo();
    if (redoFirst?.kind !== "scan") throw new Error("scan transition");
    expect(redoFirst.transition.commit()).toBe(true);
    expect(session.scanHistory.activeStages).toEqual([stage]);
    const undoAgain = session.undo();
    if (undoAgain?.kind !== "scan") throw new Error("scan transition");
    undoAgain.transition.commit();
    const coefficientUndo = session.undo();
    expect(coefficientUndo?.kind).toBe("coefficient");
    expect(session.history?.snapshot.currentState.jpegOperations).toEqual([]);
    expect(session.scanHistory.canRedo).toBe(false);
  });
});
