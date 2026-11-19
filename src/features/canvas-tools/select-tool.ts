import { previewPointToFrame } from "../../application/preview-orientation";
import {
  createRectangleSelection,
  createSpatialMask,
  type SpatialMask,
  type SpatialSelection,
} from "../../document/masks";
import {
  getJpegComponentBlockGrid,
  mapJpegBlockCoordinate,
  snapSelectionToComponentBlocks,
  snapSelectionToMcus,
  type JpegBlockCoordinate,
} from "../../jpeg/block-geometry";
import type { JpegOrientation } from "../../jpeg/orientation";
import { failure, success, type Result } from "../../shared/result";
import { selectWholeImage } from "./all-tool";
import { openMaskGesture } from "./mask-gesture";
import type {
  CanvasContext,
  CanvasFeedback,
  CanvasInteraction,
  CanvasKeyInput,
  CanvasPointerInput,
  ImagePoint,
  ImageSample,
  MaskGesture,
  MaskToolContext,
} from "./types";

function selectRectangle(
  { inspection, componentIndex, grid }: MaskToolContext,
  start: ImagePoint,
  end: ImagePoint,
): Result<SpatialSelection | null> {
  const rectangle = createRectangleSelection(
    start.x,
    start.y,
    end.x,
    end.y,
    inspection.width,
    inspection.height,
  );
  if (!rectangle.ok || !rectangle.value) return rectangle;
  if (grid === "mcu") return snapSelectionToMcus(rectangle.value, inspection);
  const component = inspection.components[componentIndex];
  return component
    ? snapSelectionToComponentBlocks(rectangle.value, inspection, component.id)
    : failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG component is invalid.",
      });
}

function createMask(
  context: MaskToolContext,
  selection: SpatialSelection,
): Result<SpatialMask> {
  return createSpatialMask(
    selection,
    context.inspection.width,
    context.inspection.height,
  );
}

function selectBlocks(
  context: MaskToolContext,
  anchor: JpegBlockCoordinate,
  cursor: JpegBlockCoordinate,
) {
  return selectRectangle(
    context,
    {
      x: Math.min(anchor.imageX, cursor.imageX),
      y: Math.min(anchor.imageY, cursor.imageY),
    },
    {
      x: Math.max(
        anchor.imageX + anchor.imageWidth,
        cursor.imageX + cursor.imageWidth,
      ),
      y: Math.max(
        anchor.imageY + anchor.imageHeight,
        cursor.imageY + cursor.imageHeight,
      ),
    },
  );
}

const ARROW_DIRECTIONS = new Map<string, ImagePoint>([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
]);

class SelectKeyboard {
  private anchor: JpegBlockCoordinate | null = null;

  reset(): void {
    this.anchor = null;
  }

  initialCursor({ inspection, componentIndex }: MaskToolContext) {
    const component = inspection.components[componentIndex];
    const grid =
      component && getJpegComponentBlockGrid(inspection, component.id);
    if (!grid) return null;
    const coordinate = mapJpegBlockCoordinate(
      inspection,
      component.id,
      Math.floor(grid.columns / 2),
      Math.floor(grid.rows / 2),
    );
    return coordinate.ok ? coordinate.value : null;
  }

  handleKey(
    context: MaskToolContext,
    cursor: JpegBlockCoordinate | null,
    key: string,
    orientation: JpegOrientation,
  ): Result<CanvasFeedback | null> {
    if (key === "Escape") {
      this.reset();
      return success({
        draft: null,
        keyboardCursor: this.initialCursor(context),
        selection: { mask: null, autoApply: false },
        announcement: "Selection cleared.",
      });
    }
    const direction = ARROW_DIRECTIONS.get(key);
    if (!direction && key !== "Enter") return success(null);
    const { inspection, componentIndex } = context;
    const component = inspection.components[componentIndex];
    const grid =
      component && getJpegComponentBlockGrid(inspection, component.id);
    if (!grid) return success(null);
    const current =
      cursor?.componentId === component.id
        ? cursor
        : this.initialCursor(context);
    if (!current) return success(null);

    if (direction) {
      const delta = previewPointToFrame(
        direction.x,
        direction.y,
        0,
        0,
        orientation,
      );
      const moved = mapJpegBlockCoordinate(
        inspection,
        component.id,
        Math.max(0, Math.min(grid.columns - 1, current.blockX + delta.x)),
        Math.max(0, Math.min(grid.rows - 1, current.blockY + delta.y)),
      );
      if (!moved.ok) return moved;
      const draft = this.anchor
        ? selectBlocks(context, this.anchor, moved.value)
        : success(undefined);
      if (!draft.ok) return draft;
      return success({
        keyboardCursor: moved.value,
        draft: draft.value
          ? { kind: "rectangle", selection: draft.value }
          : draft.value,
        announcement: `DCT block ${moved.value.blockX + 1} of ${grid.columns}, row ${moved.value.blockY + 1} of ${grid.rows}.`,
      });
    }

    const selection = selectBlocks(context, this.anchor ?? current, current);
    if (!selection.ok || !selection.value)
      return selection.ok ? success(null) : selection;
    if (!this.anchor) {
      this.anchor = current;
      return success({
        keyboardCursor: current,
        draft: { kind: "rectangle", selection: selection.value },
        announcement: `Selection started at DCT block ${current.blockX + 1}, row ${current.blockY + 1}. Use arrow keys to extend it, then Enter to finish or Escape to clear.`,
      });
    }
    const mask = createMask(context, selection.value);
    if (!mask.ok) return mask;
    this.reset();
    return success({
      draft: null,
      selection: { mask: mask.value, autoApply: true },
      announcement: "Rectangle selection complete.",
    });
  }
}

export class SelectTool implements CanvasInteraction {
  private readonly keyboard = new SelectKeyboard();

  begin({ image }: CanvasPointerInput, context: CanvasContext) {
    if (!image) return null;
    this.keyboard.reset();
    return openMaskGesture(this.start(context, image), context);
  }

  private start(
    context: MaskToolContext,
    { point: start }: ImageSample,
  ): Result<MaskGesture> {
    let draft: SpatialSelection | null = null;
    return success({
      move({ point }) {
        const selection = selectRectangle(context, start, point);
        if (!selection.ok) return selection;
        draft = selection.value;
        return success(undefined);
      },
      getDraft: () => (draft ? { kind: "rectangle", selection: draft } : null),
      end(sample) {
        if (!sample) return success(null);
        const selection = selectRectangle(context, start, sample.point);
        if (!selection.ok) return selection;
        return selection.value
          ? createMask(context, selection.value)
          : success(null);
      },
      cancel() {
        draft = null;
      },
    });
  }

  focus(context: CanvasContext): void {
    context.publish({ keyboardCursor: this.getInitialCursor(context) });
  }

  getInitialCursor(context: MaskToolContext) {
    return this.keyboard.initialCursor(context);
  }

  reset(): void {
    this.keyboard.reset();
  }

  handleKey(input: CanvasKeyInput, context: CanvasContext): boolean {
    if (
      input.canvasFocused &&
      !input.altKey &&
      (input.ctrlKey || input.metaKey) &&
      input.key.toLowerCase() === "a"
    ) {
      context.cancelGesture();
      this.reset();
      context.publish({ keyboardCursor: null });
      selectWholeImage(context);
      return true;
    }
    if (!input.canvasFocused || input.altKey || input.ctrlKey || input.metaKey)
      return false;
    if (input.key === "Escape") context.cancelGesture();
    else if (input.pointerActive) return false;
    if (input.key === "Enter" && input.repeat) return true;
    const result = this.keyboard.handleKey(
      context,
      context.keyboardCursor,
      input.key,
      context.orientation,
    );
    if (!result.ok) {
      context.publish({ error: result.error.message });
      return true;
    }
    if (!result.value) return false;
    context.publish(result.value);
    return true;
  }

  getHint() {
    return {
      text: "Draw a rectangle on the photo.",
      keyboard:
        "Arrow keys move the cursor. Enter starts or completes a rectangle. Escape clears the selection. Ctrl/⌘+A selects the whole photo.",
    };
  }
}
