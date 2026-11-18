import type { EffectToolbarConfig, MaskTool } from "./types";

/** Effects whose target is a mask: All, Brush and Select with a snap grid. */
export const MASK_EFFECT_TOOLBAR: EffectToolbarConfig = Object.freeze({
  tools: Object.freeze<MaskTool[]>(["all", "brush", "select"]),
  showSnapGrid: true,
});

/** Gesture and panel effects show a disabled All button in the mask-tool row. */
export const WHOLE_IMAGE_TOOLBAR: EffectToolbarConfig = Object.freeze({
  tools: Object.freeze<MaskTool[]>(["all"]),
  showSnapGrid: false,
});
