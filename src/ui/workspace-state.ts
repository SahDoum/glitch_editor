import type { NamedSpatialMask, SpatialMask } from "../document/masks";
import type { JpegBlockCoordinate } from "../jpeg/block-geometry";

export function getHistoryDisplayEntries<T>(
  operations: readonly T[],
): readonly { readonly operation: T; readonly index: number }[] {
  return operations.map((operation, index) => ({ operation, index })).reverse();
}

export type CanvasTool =
  | "hand"
  | "inspector"
  | "brush"
  | "select"
  | "coefficient-glitch"
  | "block-transform"
  | "quantization";

export const TOOL_GROUPS: readonly {
  readonly label: string;
  readonly tools: readonly {
    readonly id: CanvasTool;
    readonly label: string;
  }[];
}[] = [
  {
    label: "Manipulation",
    tools: [
      { id: "hand", label: "Hand" },
      { id: "inspector", label: "Inspector" },
    ],
  },
  {
    label: "Masks",
    tools: [
      { id: "brush", label: "Brush" },
      { id: "select", label: "Select" },
    ],
  },
  {
    label: "JPEG effects",
    tools: [{ id: "coefficient-glitch", label: "Coefficient Glitch" }],
  },
  {
    label: "Blocks",
    tools: [{ id: "block-transform", label: "Block Transform" }],
  },
  {
    label: "Quantization",
    tools: [{ id: "quantization", label: "Quantization Matrix" }],
  },
];

export interface WorkspaceState {
  readonly activeTool: CanvasTool;
  readonly panelTool: CanvasTool;
  readonly selectionMask: SpatialMask | null;
  readonly activeMaskId: string | null;
  readonly selectedBlock: JpegBlockCoordinate | null;
  readonly isRightPanelCollapsed: boolean;
}

export interface WorkspaceOverlayVisibility {
  readonly mask: boolean;
  readonly inspectedBlock: boolean;
}

export function getWorkspaceOverlayVisibility(
  tool: CanvasTool,
): WorkspaceOverlayVisibility {
  return {
    mask:
      tool === "brush" ||
      tool === "select" ||
      tool === "coefficient-glitch" ||
      tool === "block-transform",
    inspectedBlock: tool === "inspector",
  };
}

export function getEffectMask(
  state: WorkspaceState,
  savedMasks: readonly NamedSpatialMask[],
): SpatialMask | null {
  return state.activeMaskId
    ? (savedMasks.find(({ mask }) => mask.id === state.activeMaskId)?.mask ??
        null)
    : state.selectionMask;
}

export type WorkspaceAction =
  | {
      readonly type: "activate-tool";
      readonly tool: CanvasTool;
      readonly preservePanel?: boolean;
    }
  | {
      readonly type: "activate-mask-effect";
      readonly tool: "coefficient-glitch" | "block-transform";
    }
  | { readonly type: "set-selection"; readonly selection: SpatialMask | null }
  | { readonly type: "select-mask"; readonly maskId: string | null }
  | {
      readonly type: "select-block";
      readonly block: JpegBlockCoordinate | null;
    }
  | {
      readonly type: "set-panel-collapsed";
      readonly collapsed: boolean;
    }
  | { readonly type: "reset-document" };

export const initialWorkspaceState: WorkspaceState = Object.freeze({
  activeTool: "select",
  panelTool: "select",
  selectionMask: null,
  activeMaskId: null,
  selectedBlock: null,
  isRightPanelCollapsed: false,
});

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "activate-tool":
      return {
        ...state,
        activeTool: action.tool,
        panelTool: action.preservePanel ? state.panelTool : action.tool,
        isRightPanelCollapsed: false,
      };
    case "activate-mask-effect":
      return {
        ...state,
        activeTool:
          state.activeTool === "brush" || state.activeTool === "select"
            ? state.activeTool
            : "brush",
        panelTool: action.tool,
        isRightPanelCollapsed: false,
      };
    case "set-selection":
      return {
        ...state,
        selectionMask: action.selection,
        activeMaskId: action.selection ? null : state.activeMaskId,
      };
    case "select-mask":
      return { ...state, activeMaskId: action.maskId };
    case "select-block":
      return { ...state, selectedBlock: action.block };
    case "set-panel-collapsed":
      return { ...state, isRightPanelCollapsed: action.collapsed };
    case "reset-document":
      return initialWorkspaceState;
  }
}
