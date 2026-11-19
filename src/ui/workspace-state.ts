import type { MaskTool } from "../features/canvas-tools/types";
import type { NamedSpatialMask, SpatialMask } from "../document/masks";

export function getHistoryDisplayEntries<T>(
  operations: readonly T[],
): readonly { readonly operation: T; readonly index: number }[] {
  return operations.map((operation, index) => ({ operation, index })).reverse();
}

export type { MaskTool } from "../features/canvas-tools/types";
/** "effect" means the active effect owns pointer interaction (or none). */
export type CanvasTool = MaskTool | "effect";

export interface WorkspaceState {
  readonly activeTool: CanvasTool;
  readonly areaTool: MaskTool;
  readonly activeEffectId: string | null;
  readonly selectionMask: SpatialMask | null;
  readonly activeMaskId: string | null;
}

export interface WorkspaceOverlayVisibility {
  readonly mask: boolean;
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

export function getWorkspaceOverlayVisibility(
  tool: CanvasTool,
): WorkspaceOverlayVisibility {
  return { mask: tool !== "effect" };
}

export function areaToolForMask(mask: SpatialMask | null): MaskTool {
  const shape = mask?.shapes[0];
  if (!mask || !shape) return "all";
  if (shape.kind === "brush") return "brush";
  if (
    shape.x === 0 &&
    shape.y === 0 &&
    shape.width === mask.width &&
    shape.height === mask.height
  )
    return "all";
  return "select";
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
      readonly type: "activate-effect";
      readonly effectId: string;
      /** True when the effect works through the all/brush/select tools. */
      readonly usesMaskTools: boolean;
    }
  | { readonly type: "activate-tool"; readonly tool: MaskTool }
  | { readonly type: "set-selection"; readonly selection: SpatialMask | null }
  | { readonly type: "select-mask"; readonly maskId: string | null }
  | { readonly type: "reset-document" };

export const initialWorkspaceState: WorkspaceState = Object.freeze({
  activeTool: "all",
  areaTool: "all",
  activeEffectId: null,
  selectionMask: null,
  activeMaskId: null,
});

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "activate-effect":
      return {
        ...state,
        activeEffectId: action.effectId,
        activeTool: action.usesMaskTools ? state.areaTool : "effect",
      };
    case "activate-tool": {
      const clearArea = state.areaTool === "all" && action.tool !== "all";
      return {
        ...state,
        activeTool: action.tool,
        areaTool: action.tool,
        selectionMask: clearArea ? null : state.selectionMask,
        activeMaskId: clearArea ? null : state.activeMaskId,
      };
    }
    case "set-selection":
      return {
        ...state,
        selectionMask: action.selection,
        activeMaskId: action.selection ? null : state.activeMaskId,
      };
    case "select-mask":
      return { ...state, activeMaskId: action.maskId };
    case "reset-document":
      return {
        ...initialWorkspaceState,
        activeEffectId: state.activeEffectId,
        activeTool: state.activeTool === "effect" ? "effect" : "all",
      };
  }
}
