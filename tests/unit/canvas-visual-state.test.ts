import { describe, expect, it, vi } from "vitest";
import { CanvasVisualState } from "../../src/ui/canvas-visual-state";

describe("canvas presentation subscriptions", () => {
  it("publishes hover/draft updates to overlay subscribers independently of document state", () => {
    const state = new CanvasVisualState();
    const notify = vi.fn();
    const unsubscribe = state.subscribe(notify);
    const initial = state.getSnapshot();
    const point = { x: 2, y: 3 };
    state.publish({ hoverPoint: point });
    expect(state.getSnapshot().hoverPoint).toBe(point);
    expect(state.getSnapshot().draft).toBe(null);
    expect(state.getSnapshot()).not.toBe(initial);
    expect(initial.hoverPoint).toBe(null);
    state.publish({ hoverPoint: point });
    expect(notify).toHaveBeenCalledTimes(1);
    state.publish({ error: "does not change visual state" });
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    state.reset();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(state.getSnapshot()).toEqual(initial);
  });

  it("resets a pending gesture and keeps stable snapshots between events", () => {
    const state = new CanvasVisualState();
    const draft = {
      kind: "brush" as const,
      strokes: [[{ x: 1, y: 2 }]],
      radius: 4,
    };
    state.publish({ draft });
    const snapshot = state.getSnapshot();
    expect(state.getSnapshot()).toBe(snapshot);
    expect(snapshot.draft).toBe(draft);
    state.reset();
    expect(state.getSnapshot().draft).toBe(null);
    expect(snapshot.draft).toBe(draft);
  });
});
