import type { SpatialMask } from "../document/masks";
import type { JpegBlockCoordinate } from "../jpeg/block-geometry";

export type CanvasTool =
  | "hand"
  | "inspector"
  | "brush"
  | "select"
  | "repeat-block"
  | "shuffle"
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
    label: "Coefficients",
    tools: [
      { id: "brush", label: "Brush" },
      { id: "select", label: "Select" },
    ],
  },
  {
    label: "Blocks",
    tools: [
      { id: "repeat-block", label: "Repeat Block" },
      { id: "shuffle", label: "Shuffle" },
    ],
  },
  {
    label: "Quantization",
    tools: [{ id: "quantization", label: "Quantization Matrix" }],
  },
];

export interface WorkspaceState {
  readonly activeTool: CanvasTool;
  readonly selectionMask: SpatialMask | null;
  readonly selectedBlock: JpegBlockCoordinate | null;
  readonly isRightPanelCollapsed: boolean;
}

export type WorkspaceAction =
  | { readonly type: "activate-tool"; readonly tool: CanvasTool }
  | { readonly type: "set-selection"; readonly selection: SpatialMask | null }
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
  selectionMask: null,
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
        isRightPanelCollapsed: false,
      };
    case "set-selection":
      return { ...state, selectionMask: action.selection };
    case "select-block":
      return { ...state, selectedBlock: action.block };
    case "set-panel-collapsed":
      return { ...state, isRightPanelCollapsed: action.collapsed };
    case "reset-document":
      return initialWorkspaceState;
  }
}
