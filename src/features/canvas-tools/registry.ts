import type { ComponentType } from "react";
import { AllTool } from "./all-tool";
import { BrushControls } from "./brush-controls";
import { BrushTool } from "./brush-tool";
import { SelectTool } from "./select-tool";
import type { CanvasInteraction } from "./types";

/** Settings and setters the toolbar passes to a registered Controls component. */
export interface CanvasToolControlsProps {
  readonly brushSize: number;
  readonly onChangeBrushSize: (size: number) => void;
}

/** Toolbar presentation for a registered mask tool. */
interface MaskToolView {
  readonly label: string;
  readonly shortcut: string;
  readonly iconPaths: readonly string[];
  readonly dashed?: boolean;
  readonly canvasClass?: string;
  readonly snapGrid?: boolean;
  /** Extra settings shown when this tool is active, such as the brush size slider. */
  readonly Controls?: ComponentType<CanvasToolControlsProps>;
  readonly keyShortcuts?: string;
}

/** Pairs a controller constructor per editor instance with its shared presentation. */
interface CanvasToolEntry {
  readonly Controller: new () => CanvasInteraction;
  readonly view: MaskToolView;
}

export const MASK_TOOL_REGISTRY = {
  all: {
    Controller: AllTool,
    view: {
      label: "Whole photo",
      shortcut: "A",
      iconPaths: ["M5 3h10l4 4v14H5z", "M15 3v5h4"],
    },
  },
  brush: {
    Controller: BrushTool,
    view: {
      label: "Brush",
      shortcut: "B",
      iconPaths: ["m4 16 9-9 4 4-9 9H4v-4Z", "m12 8 3-3 4 4-3 3", "M4 21h7"],
      canvasClass: "is-brushing",
      snapGrid: true,
      Controls: BrushControls,
    },
  },
  select: {
    Controller: SelectTool,
    view: {
      label: "Rectangle",
      shortcut: "M",
      iconPaths: ["M4 4h16v16H4z"],
      dashed: true,
      canvasClass: "is-selecting",
      snapGrid: true,
      keyShortcuts: "Control+A Meta+A",
    },
  },
} satisfies Readonly<Record<string, CanvasToolEntry>>;

/** Registered tool IDs that an effect can list in its toolbar. */
export type MaskTool = keyof typeof MASK_TOOL_REGISTRY;

export function getMaskToolView(id: MaskTool): MaskToolView {
  return MASK_TOOL_REGISTRY[id].view;
}

export function createCanvasToolControllers(
  registry: Readonly<Record<string, CanvasToolEntry>> = MASK_TOOL_REGISTRY,
): ReadonlyMap<string, CanvasInteraction> {
  return new Map(
    Object.entries(registry).map(([id, { Controller }]) => [
      id,
      new Controller(),
    ]),
  );
}
