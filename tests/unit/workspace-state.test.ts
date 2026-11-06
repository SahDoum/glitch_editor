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
  TOOL_GROUPS,
  workspaceReducer,
} from "../../src/ui/workspace-state";
import { getRectangleSelection } from "../../src/ui/selection-overlay";

describe("workspace state", () => {
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

  it("defines the milestone toolbar groups and tools in order", () => {
    expect(
      TOOL_GROUPS.map((group) => [
        group.label,
        group.tools.map((tool) => tool.id),
      ]),
    ).toEqual([
      ["Manipulation", ["hand", "inspector"]],
      ["Masks", ["brush", "select"]],
      ["JPEG effects", ["coefficient-glitch"]],
      ["Blocks", ["block-transform"]],
      ["Quantization", ["quantization"]],
    ]);
  });

  it("preserves the shared selection while switching tools", () => {
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
    expect(next.selectionMask).toBe(mask.value);
  });

  it("can edit a mask without replacing the selected effect panel", () => {
    const effect = workspaceReducer(initialWorkspaceState, {
      type: "activate-tool",
      tool: "coefficient-glitch",
    });
    const drawing = workspaceReducer(effect, {
      type: "activate-tool",
      tool: "brush",
      preservePanel: true,
    });
    expect(drawing.activeTool).toBe("brush");
    expect(drawing.panelTool).toBe("coefficient-glitch");
    const hand = workspaceReducer(drawing, {
      type: "activate-tool",
      tool: "hand",
    });
    expect(hand.panelTool).toBe("hand");
  });

  it("keeps the chosen mask tool when activating a mask-consuming effect", () => {
    const selecting = workspaceReducer(initialWorkspaceState, {
      type: "activate-tool",
      tool: "select",
    });
    for (const tool of ["coefficient-glitch", "block-transform"] as const) {
      const effect = workspaceReducer(selecting, {
        type: "activate-mask-effect",
        tool,
      });
      expect(effect.activeTool).toBe("select");
      expect(effect.panelTool).toBe(tool);
      const brushing = workspaceReducer(effect, {
        type: "activate-tool",
        tool: "brush",
        preservePanel: true,
      });
      expect(brushing.activeTool).toBe("brush");
      expect(brushing.panelTool).toBe(tool);
      const selectingAgain = workspaceReducer(brushing, {
        type: "activate-tool",
        tool: "select",
        preservePanel: true,
      });
      expect(selectingAgain.activeTool).toBe("select");
      expect(selectingAgain.panelTool).toBe(tool);
    }
  });

  it("defaults to the brush when entering a mask effect from a non-mask tool", () => {
    const hand = workspaceReducer(initialWorkspaceState, {
      type: "activate-tool",
      tool: "hand",
    });
    const effect = workspaceReducer(hand, {
      type: "activate-mask-effect",
      tool: "coefficient-glitch",
    });
    expect(effect.activeTool).toBe("brush");
    expect(effect.panelTool).toBe("coefficient-glitch");
    const transform = workspaceReducer(effect, {
      type: "activate-tool",
      tool: "block-transform",
    });
    expect(transform.activeTool).toBe("block-transform");
    expect(transform.panelTool).toBe("block-transform");
  });

  it("keeps the rectangle selection frame available after changing tools", () => {
    const selection = createRectangleSelection(1, 2, 8, 9, 16, 16);
    if (!selection.ok || !selection.value)
      throw new Error("Expected selection");
    const mask = createSpatialMask(selection.value, 16, 16);
    if (!mask.ok) throw new Error("Expected selection mask");
    const switched = workspaceReducer(
      workspaceReducer(initialWorkspaceState, {
        type: "set-selection",
        selection: mask.value,
      }),
      { type: "activate-tool", tool: "brush" },
    );

    expect(getRectangleSelection(switched.selectionMask)).toEqual(
      selection.value,
    );
  });

  it("keeps block inspection independent from selection and panel state", () => {
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
    if (!mask.ok) throw new Error("Expected selection mask");
    const selected = workspaceReducer(initialWorkspaceState, {
      type: "set-selection",
      selection: mask.value,
    });

    const block = {
      componentId: 0,
      blockX: 1,
      blockY: 2,
      imageX: 8,
      imageY: 16,
      imageWidth: 8,
      imageHeight: 8,
      mcuX: 0,
      mcuY: 0,
      blockInMcuX: 1,
      blockInMcuY: 2,
    };

    const withBlock = workspaceReducer(selected, {
      type: "select-block",
      block,
    });
    const collapsed = workspaceReducer(withBlock, {
      type: "set-panel-collapsed",
      collapsed: true,
    });
    const expanded = workspaceReducer(collapsed, {
      type: "set-panel-collapsed",
      collapsed: false,
    });

    expect(withBlock.selectedBlock).toBe(block);
    expect(collapsed.isRightPanelCollapsed).toBe(true);
    expect(expanded.isRightPanelCollapsed).toBe(false);
    expect(expanded.selectedBlock).toBe(block);
    expect(expanded.selectionMask).toBe(mask.value);
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
      type: "activate-tool",
      tool: "coefficient-glitch",
    });

    expect(effectTool.selectionMask).toBe(mask.value);
    expect(effectTool.activeMaskId).toBe("saved-mask-id");
    expect(getWorkspaceOverlayVisibility("coefficient-glitch")).toEqual({
      mask: true,
      inspectedBlock: false,
    });
    expect(getWorkspaceOverlayVisibility("block-transform")).toEqual({
      mask: true,
      inspectedBlock: false,
    });
    expect(getWorkspaceOverlayVisibility("inspector")).toEqual({
      mask: false,
      inspectedBlock: true,
    });
    expect(getWorkspaceOverlayVisibility("quantization")).toEqual({
      mask: false,
      inspectedBlock: false,
    });
    expect(getWorkspaceOverlayVisibility("hand").mask).toBe(false);
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
    for (const tool of ["coefficient-glitch", "block-transform"] as const) {
      const effect = workspaceReducer(draft, { type: "activate-tool", tool });
      expect(getEffectMask(effect, saved)).toBe(second.value);
      expect(getWorkspaceOverlayVisibility(tool).mask).toBe(true);
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

  it("resets document-specific workspace state", () => {
    const changed = {
      ...initialWorkspaceState,
      activeTool: "inspector" as const,
      isRightPanelCollapsed: true,
    };

    expect(workspaceReducer(changed, { type: "reset-document" })).toBe(
      initialWorkspaceState,
    );
  });
});
