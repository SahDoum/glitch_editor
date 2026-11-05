import { describe, expect, it } from "vitest";
import {
  createRectangleSelection,
  createSpatialMask,
} from "../../src/document/masks";
import {
  initialWorkspaceState,
  TOOL_GROUPS,
  workspaceReducer,
} from "../../src/ui/workspace-state";
import {
  getBrushOverlayPath,
  getRectangleSelection,
} from "../../src/ui/selection-overlay";

describe("workspace state", () => {
  it("defines the milestone toolbar groups and tools in order", () => {
    expect(
      TOOL_GROUPS.map((group) => [
        group.label,
        group.tools.map((tool) => tool.id),
      ]),
    ).toEqual([
      ["Manipulation", ["hand", "inspector"]],
      ["Coefficients", ["brush", "select"]],
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

describe("brush overlay path", () => {
  it("joins brush samples into one continuous SVG stroke", () => {
    expect(
      getBrushOverlayPath([
        { x: 2, y: 3 },
        { x: 5, y: 7 },
        { x: 9, y: 11 },
      ]),
    ).toBe("M 2 3 L 5 7 L 9 11");
  });

  it("returns an empty path when there are no brush samples", () => {
    expect(getBrushOverlayPath([])).toBe("");
  });
});
