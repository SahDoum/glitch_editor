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
  | "info"
  | "all"
  | "brush"
  | "select"
  | "coefficient-glitch"
  | "block-transform"
  | "quantization"
  | "scan-corrupt";

export const TOOL_GROUPS: readonly {
  readonly label: string;
  readonly tools: readonly {
    readonly id: CanvasTool;
    readonly label: string;
    readonly shortcut: string;
  }[];
}[] = [
  {
    label: "Manipulation",
    tools: [
      { id: "hand", label: "Hand", shortcut: "V" },
      { id: "inspector", label: "Inspector", shortcut: "I" },
    ],
  },
  {
    label: "Information",
    tools: [{ id: "info", label: "Info", shortcut: "F" }],
  },
  {
    label: "Effects and masks",
    tools: [
      { id: "coefficient-glitch", label: "Coefficient Glitch", shortcut: "G" },
      { id: "all", label: "All", shortcut: "A" },
      { id: "brush", label: "Brush", shortcut: "B" },
      { id: "select", label: "Select", shortcut: "M" },
    ],
  },
  {
    label: "Blocks",
    tools: [{ id: "block-transform", label: "Block Transform", shortcut: "T" }],
  },
  {
    label: "Quantization",
    tools: [
      { id: "quantization", label: "Quantization Matrix", shortcut: "Q" },
    ],
  },
  {
    label: "Entropy experiments",
    tools: [{ id: "scan-corrupt", label: "Scan Corrupt", shortcut: "C" }],
  },
];

export interface WorkspaceState {
  readonly activeTool: CanvasTool;
  readonly panelTool: CanvasTool;
  readonly selectionMask: SpatialMask | null;
  readonly activeMaskId: string | null;
  readonly selectedBlock: JpegBlockCoordinate | null;
}

export interface WorkspaceOverlayVisibility {
  readonly mask: boolean;
  readonly inspectedBlock: boolean;
}

export type WorkspaceShortcut =
  "undo" | "redo" | "save" | "open-file" | "select-all" | null;

export function getWorkspaceShortcut(input: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey?: boolean;
}): WorkspaceShortcut {
  if ((!input.ctrlKey && !input.metaKey) || input.altKey) return null;
  switch (input.key.toLowerCase()) {
    case "z":
      return input.shiftKey ? "redo" : "undo";
    case "y":
      return "redo";
    case "s":
      return "save";
    case "o":
      return "open-file";
    case "a":
      return "select-all";
    default:
      return null;
  }
}

export function getCanvasToolShortcut(key: string): CanvasTool | null {
  const shortcut = key.toUpperCase();
  for (const group of TOOL_GROUPS) {
    const tool = group.tools.find(
      ({ shortcut: keyShortcut }) => keyShortcut === shortcut,
    );
    if (tool) return tool.id;
  }
  return null;
}

export function isCanvasToolEnabled(
  tool: CanvasTool,
  panelTool: CanvasTool,
  blockMaskMode = false,
): boolean {
  return (
    (tool !== "brush" && tool !== "select") ||
    panelTool === "coefficient-glitch" ||
    (panelTool === "block-transform" && blockMaskMode)
  );
}

export function getWorkspaceOverlayVisibility(
  tool: CanvasTool,
): WorkspaceOverlayVisibility {
  return {
    mask:
      tool === "brush" ||
      tool === "select" ||
      tool === "all" ||
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
  | { readonly type: "reset-document" };

export const initialWorkspaceState: WorkspaceState = Object.freeze({
  activeTool: "all",
  panelTool: "hand",
  selectionMask: null,
  activeMaskId: null,
  selectedBlock: null,
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
      };
    case "activate-mask-effect":
      return {
        ...state,
        activeTool:
          state.activeTool === "all" ||
          state.activeTool === "brush" ||
          state.activeTool === "select"
            ? state.activeTool
            : "all",
        panelTool: action.tool,
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
    case "reset-document":
      return initialWorkspaceState;
  }
}
