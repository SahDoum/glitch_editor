import { describe, expect, it } from "vitest";
import { ScanCorruptionHistory } from "../../src/application/scan-corruption";

const first = {
  mode: "bit-flip" as const,
  count: 2,
  rangeStart: 0,
  rangeEnd: 1,
  seed: 1,
};

const second = {
  mode: "byte-replacement" as const,
  count: 3,
  rangeStart: 0.25,
  rangeEnd: 0.75,
  seed: 2,
};

describe("terminal scan corruption history", () => {
  it("supports ordered, replayable stages and undo/redo without mutating parameters", () => {
    const history = new ScanCorruptionHistory();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.record(first).ok).toBe(true);
    expect(history.record(second).ok).toBe(true);
    expect(history.activeStages).toEqual([first, second]);
    expect(history.undoTarget).toEqual([first]);
    expect(history.commitUndo()).toBe(true);
    expect(history.activeStages).toEqual([first]);
    expect(history.redoTarget).toEqual([first, second]);
    expect(history.commitRedo()).toBe(true);
    expect(history.activeStages).toEqual([first, second]);
    expect(history.canRedo).toBe(false);
  });

  it("clears redo stages after a new corruption and enforces the stage limit", () => {
    const history = new ScanCorruptionHistory();
    expect(history.record(first).ok).toBe(true);
    expect(history.commitUndo()).toBe(true);
    expect(history.canRedo).toBe(true);
    expect(history.record(second).ok).toBe(true);
    expect(history.canRedo).toBe(false);

    for (let index = 2; index <= 8; index += 1) {
      expect(history.record({ ...first, seed: index }).ok).toBe(true);
    }
    expect(history.record(first)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("replays parameter edits as an undoable replacement of the last stage", () => {
    const history = new ScanCorruptionHistory();
    expect(history.record(first).ok).toBe(true);
    expect(history.record(second).ok).toBe(true);
    const edited = { ...second, seed: 99 };
    expect(history.replaceLast(edited).ok).toBe(true);
    expect(history.activeStages).toEqual([first, edited]);
    expect(history.commitUndo()).toBe(true);
    expect(history.activeStages).toEqual([first, second]);
    expect(history.commitRedo()).toBe(true);
    expect(history.activeStages).toEqual([first, edited]);
  });
});
