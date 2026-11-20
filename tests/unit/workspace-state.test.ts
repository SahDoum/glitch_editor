import { describe, expect, it } from "vitest";
import {
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";
import {
  initialWorkspaceState,
  getHistoryDisplayEntries,
  getWorkspaceOverlayVisibility,
  getWorkspaceShortcut,
  workspaceReducer,
} from "../../src/ui/workspace-state";
import { getRectangleSelection } from "../../src/ui/selection-overlay";

describe("workspace state", () => {
  it("maps platform keyboard shortcuts to editor actions", () => {
    expect(
      getWorkspaceShortcut({
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("undo");
    expect(
      getWorkspaceShortcut({
        key: "Z",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      getWorkspaceShortcut({
        key: "s",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe("save");
    expect(
      getWorkspaceShortcut({
        key: "o",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("open-file");
    expect(
      getWorkspaceShortcut({
        key: "z",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(
      getWorkspaceShortcut({
        key: "a",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("select-all");
    expect(
      getWorkspaceShortcut({
        key: "s",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      }),
    ).toBeNull();
  });

  it("activates a gesture or panel effect without mask tools", () => {
    const effect = workspaceReducer(initialWorkspaceState, {
      type: "activate-effect",
      effectId: "block-transfer",
      usesMaskTools: false,
    });
    expect(effect.activeEffectId).toBe("block-transfer");
    expect(effect.activeTool).toBe("effect");
    expect(getWorkspaceOverlayVisibility("effect")).toEqual({ mask: false });
  });

  it("displays the newest operation first without changing replay order", () => {
    const operations = ["first", "second", "third"];
    expect(getHistoryDisplayEntries(operations)).toEqual([
      { operation: "third", index: 2 },
      { operation: "second", index: 1 },
      { operation: "first", index: 0 },
    ]);
    expect(operations).toEqual(["first", "second", "third"]);
    expect(getHistoryDisplayEntries([])).toEqual([]);
  });

  it("starts with an empty local area after leaving Whole photo", () => {
    const selection = createRectangleSelection(1, 2, 8, 9, 16, 16);
    if (!selection.ok || !selection.value)
      throw new Error("Expected selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error("Expected selection mask");
    const selected = workspaceReducer(initialWorkspaceState, {
      type: "set-selection",
      selection: mask.value,
    });

    const next = workspaceReducer(selected, {
      type: "activate-tool",
      tool: "brush",
    });

    expect(next.activeTool).toBe("brush");
    expect(next.selectionMask).toBeNull();
  });

  it("keeps the chosen mask tool when switching between mask effects", () => {
    const selecting = workspaceReducer(initialWorkspaceState, {
      type: "activate-tool",
      tool: "select",
    });
    for (const effectId of ["pixelate", "block-shuffle"]) {
      const effect = workspaceReducer(selecting, {
        type: "activate-effect",
        effectId,
        usesMaskTools: true,
      });
      expect(effect.activeTool).toBe("select");
      expect(effect.activeEffectId).toBe(effectId);
      const brushing = workspaceReducer(effect, {
        type: "activate-tool",
        tool: "brush",
      });
      expect(brushing.activeTool).toBe("brush");
      expect(brushing.activeEffectId).toBe(effectId);
    }
  });

  it("restores the area tool after a temporary gesture effect", () => {
    const selecting = workspaceReducer(initialWorkspaceState, {
      type: "activate-tool",
      tool: "select",
    });
    const gesture = workspaceReducer(selecting, {
      type: "activate-effect",
      effectId: "block-repeat",
      usesMaskTools: false,
    });
    const mask = workspaceReducer(gesture, {
      type: "activate-effect",
      effectId: "pixelate",
      usesMaskTools: true,
    });
    expect(mask.activeTool).toBe("select");
    expect(mask.activeEffectId).toBe("pixelate");
    expect(getWorkspaceOverlayVisibility("all")).toEqual({ mask: true });
  });

  it("keeps the rectangle selection frame available after changing tools", () => {
    const selection = createRectangleSelection(1, 2, 8, 9, 16, 16);
    if (!selection.ok || !selection.value)
      throw new Error("Expected selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error("Expected selection mask");
    const switched = workspaceReducer(
      workspaceReducer(
        workspaceReducer(initialWorkspaceState, {
          type: "activate-tool",
          tool: "select",
        }),
        { type: "set-selection", selection: mask.value },
      ),
      { type: "activate-tool", tool: "brush" },
    );

    expect(getRectangleSelection(switched.selectionMask)).toEqual(
      selection.value,
    );
  });

  it("uses the current draft for mask effects and preserves it across gesture effects", () => {
    const rectangle = createRectangleSelection(1, 2, 8, 9, 16, 16);
    if (!rectangle.ok || !rectangle.value) throw new Error("selection");
    const mask = createSpatialMask(rectangle.value, 16, 16);
    if (!mask.ok) throw new Error("mask");
    const draft = workspaceReducer(initialWorkspaceState, {
      type: "set-selection",
      selection: mask.value,
    });
    const gesture = workspaceReducer(draft, {
      type: "activate-effect",
      effectId: "block-transfer",
      usesMaskTools: false,
    });
    const shuffle = workspaceReducer(gesture, {
      type: "activate-effect",
      effectId: "block-shuffle",
      usesMaskTools: true,
    });
    expect(gesture.selectionMask).toBe(mask.value);
    expect(shuffle.selectionMask).toBe(mask.value);
    expect(shuffle.activeTool).toBe("all");
  });
  it("resets document state and preserves gesture tool selection", () => {
    const changed = {
      ...initialWorkspaceState,
      activeEffectId: "pixelate",
      activeTool: "select" as const,
    };
    expect(workspaceReducer(changed, { type: "reset-document" })).toEqual({
      ...initialWorkspaceState,
      activeEffectId: "pixelate",
    });
    const gesture = workspaceReducer(changed, {
      type: "activate-effect",
      effectId: "block-transfer",
      usesMaskTools: false,
    });
    expect(
      workspaceReducer(gesture, { type: "reset-document" }).activeTool,
    ).toBe("effect");
  });
});
