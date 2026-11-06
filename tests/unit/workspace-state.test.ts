import { describe, expect, it } from "vitest";
import {
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";
import {
  initialWorkspaceState,
  getEffectMask,
  getWorkspaceOverlayVisibility,
  TOOL_GROUPS,
  workspaceReducer,
} from "../../src/ui/workspace-state";
import { getRectangleSelection } from "../../src/ui/selection-overlay";

describe("workspace state", () => {
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
      ["Blocks", ["repeat-block", "shuffle"]],
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
    expect(getWorkspaceOverlayVisibility("shuffle")).toEqual({
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
    expect(getWorkspaceOverlayVisibility("repeat-block").mask).toBe(false);
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
    for (const tool of ["coefficient-glitch", "shuffle"] as const) {
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
