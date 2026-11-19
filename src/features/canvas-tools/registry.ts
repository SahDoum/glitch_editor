import type { MaskTool } from "../effects/types";
import { AllTool } from "./all-tool";
import { BrushTool } from "./brush-tool";
import { SelectTool } from "./select-tool";
import {
  AllToolView,
  BrushToolView,
  SelectToolView,
  type MaskToolView,
} from "./tool-views";
import type { MaskToolController } from "./types";

type MaskToolEntry =
  | {
      readonly kind: "command";
      readonly controller: AllTool;
      readonly view: MaskToolView;
    }
  | {
      readonly kind: "gesture";
      readonly controller: MaskToolController;
      readonly view: MaskToolView;
    };

export const MASK_TOOL_REGISTRY = {
  all: { kind: "command", controller: new AllTool(), view: AllToolView },
  brush: { kind: "gesture", controller: new BrushTool(), view: BrushToolView },
  select: {
    kind: "gesture",
    controller: new SelectTool(),
    view: SelectToolView,
  },
} satisfies Record<MaskTool, MaskToolEntry>;
