import type { NamedSpatialMask, SpatialMask } from "../document/masks";
import type { MaskTool } from "../features/effects/types";

export function getHistoryDisplayEntries<T>(
  operations: readonly T[],
): readonly { readonly operation: T; readonly index: number }[] {
  return operations.map((operation, index) => ({ operation, index })).reverse();
}

/** "effect" means the active effect owns pointer interaction (or none). */
export type CanvasTool = MaskTool | "effect";

export interface WorkspaceState {
  readonly activeTool: CanvasTool;
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
  activeEffectId: null,
  selectionMask: null,
  activeMaskId: null,
});

function isMaskTool(tool: CanvasTool): tool is MaskTool {
  return tool !== "effect";
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "activate-effect":
      return {
        ...state,
        activeEffectId: action.effectId,
        activeTool: action.usesMaskTools
          ? isMaskTool(state.activeTool)
            ? state.activeTool
            : "all"
          : "effect",
      };
    case "activate-tool":
      return { ...state, activeTool: action.tool };
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
