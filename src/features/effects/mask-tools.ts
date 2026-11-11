import type {
  EffectToolbarConfig,
  MaskTool,
  MaskToolDeclaration,
} from "./types";

const MASK_TOOL_DECLARATIONS: Readonly<Record<MaskTool, MaskToolDeclaration>> =
  {
    all: { id: "all", label: "All", shortcut: "A" },
    brush: { id: "brush", label: "Brush", shortcut: "B" },
    select: { id: "select", label: "Select", shortcut: "M" },
  };

/** Effects whose target is a mask: All, Brush and Select with a snap grid. */
export const MASK_EFFECT_TOOLBAR: EffectToolbarConfig = Object.freeze({
  tools: Object.freeze([
    MASK_TOOL_DECLARATIONS.all,
    MASK_TOOL_DECLARATIONS.brush,
    MASK_TOOL_DECLARATIONS.select,
  ]),
  showSnapGrid: true,
});

/** Effects without a mask keep only the whole-image shortcut. */
export const WHOLE_IMAGE_TOOLBAR: EffectToolbarConfig = Object.freeze({
  tools: Object.freeze([MASK_TOOL_DECLARATIONS.all]),
  showSnapGrid: false,
});
