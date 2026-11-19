import { describe, expect, it } from "vitest";
import {
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";
import {
  initialWorkspaceState,
  getEffectMask,
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

  it("selects named masks independently from the mask draft", () => {
    const mask = createSpatialMask(
      {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 0,
        y: 0,
        width: 8,
        height: 8,
      },
      16,
      16,
    );
    if (!mask.ok) throw new Error("Expected mask");
    const draft = workspaceReducer(initialWorkspaceState, {
      type: "set-selection",
      selection: mask.value,
    });
    const selected = workspaceReducer(draft, {
      type: "select-mask",
      maskId: "saved-mask-id",
    });
    const effectTool = workspaceReducer(selected, {
      type: "activate-effect",
      effectId: "pixelate",
      usesMaskTools: true,
    });

    expect(effectTool.selectionMask).toBe(mask.value);
    expect(effectTool.activeMaskId).toBe("saved-mask-id");
    expect(getWorkspaceOverlayVisibility("brush")).toEqual({ mask: true });
  });

  it("uses the latest draft by default and allows explicitly selecting a saved mask", () => {
    const first = createSpatialMask(
      {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 0,
        y: 0,
        width: 8,
        height: 8,
      },
      16,
      16,
    );
    const second = createSpatialMask(
      {
        kind: "rectangle",
        coordinateSpace: "image-pixel",
        x: 8,
        y: 8,
        width: 8,
        height: 8,
      },
      16,
      16,
    );
    if (!first.ok || !second.ok) throw new Error("Expected masks");
    const saved = [{ name: "Saved", mask: first.value }];
    const draft = workspaceReducer(initialWorkspaceState, {
      type: "set-selection",
      selection: second.value,
    });
    for (const effectId of ["pixelate", "block-shuffle"]) {
      const effect = workspaceReducer(draft, {
        type: "activate-effect",
        effectId,
        usesMaskTools: true,
      });
      expect(getEffectMask(effect, saved)).toBe(second.value);
    }

    const selected = workspaceReducer(draft, {
      type: "select-mask",
      maskId: first.value.id,
    });
    expect(getEffectMask(selected, saved)).toBe(first.value);
    expect(getEffectMask(selected, [])).toBeNull();
    const switchedBack = workspaceReducer(selected, {
      type: "select-mask",
      maskId: null,
    });
    expect(getEffectMask(switchedBack, saved)).toBe(second.value);
    const newDraft = workspaceReducer(selected, {
      type: "set-selection",
      selection: second.value,
    });
    expect(newDraft.activeMaskId).toBeNull();
    expect(getEffectMask(newDraft, saved)).toBe(second.value);
    expect(
      getEffectMask(
        workspaceReducer(newDraft, { type: "set-selection", selection: null }),
        saved,
      ),
    ).toBeNull();
  });

  it("resets document-specific state but keeps the active effect", () => {
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
