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
import type { ImagePoint } from "../effects/types";
import type {
  ImageSample,
  MaskDraft,
  MaskGesture,
  MaskToolContext,
  MaskToolController,
} from "./types";

function selectRectangle(
  context: MaskToolContext,
  start: ImagePoint,
  end: ImagePoint,
): Result<SpatialSelection | null> {
  const { inspection, componentIndex, grid } = context;
  const selected = createRectangleSelection(
    start.x,
    start.y,
    end.x,
    end.y,
    inspection.width,
    inspection.height,
  );
  if (!selected.ok || !selected.value) return selected;
  if (grid === "mcu") return snapSelectionToMcus(selected.value, inspection);
  const component = inspection.components[componentIndex];
  if (!component) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
    });
  }
  return snapSelectionToComponentBlocks(
    selected.value,
    inspection,
    component.id,
  );
}

function maskFromRectangle(
  context: MaskToolContext,
  selected: Result<SpatialSelection | null>,
): Result<SpatialMask | null> {
  if (!selected.ok) return selected;
  if (!selected.value) return success(null);
  const { width, height } = context.inspection;
  return createSpatialMask(selected.value, width, height);
}

class RectangleGesture implements MaskGesture {
  private selection: SpatialSelection | null = null;

  constructor(
    private readonly context: MaskToolContext,
    private readonly start: ImagePoint,
  ) {}

  move({ point }: ImageSample) {
    const selected = selectRectangle(this.context, this.start, point);
    if (!selected.ok) return selected;
    this.selection = selected.value;
    return success(undefined);
  }

  getDraft(): MaskDraft | null {
    return this.selection
      ? { kind: "rectangle", selection: this.selection }
      : null;
  }

  end(sample: ImageSample | null) {
    this.cancel();
    return sample
      ? maskFromRectangle(
          this.context,
          selectRectangle(this.context, this.start, sample.point),
        )
      : success(null);
  }

  cancel() {
    this.selection = null;
  }
}

const DIRECTION_BY_KEY = new Map<string, ImagePoint>([
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
]);

interface KeyboardSelectionUpdate {
  readonly draft: MaskDraft | null;
  readonly announcement: string;
  readonly mask?: SpatialMask | null;
}

function getKeyboardStart({ inspection, componentIndex }: MaskToolContext) {
  const component = inspection.components[componentIndex];
  if (!component) return null;
  const grid = getJpegComponentBlockGrid(inspection, component.id);
  if (!grid) return null;
  const cursor = mapJpegBlockCoordinate(
    inspection,
    component.id,
    Math.floor(grid.columns / 2),
    Math.floor(grid.rows / 2),
  );
  return cursor.ok ? { cursor: cursor.value, ...grid } : null;
}

export class KeyboardRectangle {
  private anchor: JpegBlockCoordinate | null = null;

  constructor(
    private readonly context: MaskToolContext,
    private readonly orientation: JpegOrientation,
    private cursor: JpegBlockCoordinate,
    private readonly columns: number,
    private readonly rows: number,
  ) {}

  getCursor() {
    return this.cursor;
  }

  move(key: string): Result<KeyboardSelectionUpdate> | null {
    const direction = DIRECTION_BY_KEY.get(key);
    if (!direction) return null;
    const { x, y } = previewPointToFrame(
      direction.x,
      direction.y,
      0,
      0,
      this.orientation,
    );
    const moved = mapJpegBlockCoordinate(
      this.context.inspection,
      this.cursor.componentId,
      Math.max(0, Math.min(this.columns - 1, this.cursor.blockX + x)),
      Math.max(0, Math.min(this.rows - 1, this.cursor.blockY + y)),
    );
    if (!moved.ok) return moved;
    this.cursor = moved.value;
    return success({
      draft: this.getDraft(),
      announcement: `DCT block ${this.cursor.blockX + 1} of ${this.columns}, row ${this.cursor.blockY + 1} of ${this.rows}.`,
    });
  }

  confirm(): Result<KeyboardSelectionUpdate> {
    if (!this.anchor) {
      this.anchor = this.cursor;
      return success({
        draft: this.getDraft(),
        announcement: `Selection started at DCT block ${this.cursor.blockX + 1}, row ${this.cursor.blockY + 1}. Use arrow keys to extend it, then Enter to finish or Escape to clear.`,
      });
    }
    const selected = this.selectToCursor(this.anchor);
    this.anchor = null;
    const mask = maskFromRectangle(this.context, selected);
    if (!mask.ok) return mask;
    return success({
      mask: mask.value,
      draft: null,
      announcement: "Rectangle selection complete.",
    });
  }

  clear() {
    this.anchor = null;
  }

  private getDraft(): MaskDraft | null {
    if (!this.anchor) return null;
    const selected = this.selectToCursor(this.anchor);
    return selected.ok && selected.value
      ? { kind: "rectangle", selection: selected.value }
      : null;
  }

  private selectToCursor(anchor: JpegBlockCoordinate) {
    const cursor = this.cursor;
    return selectRectangle(
      this.context,
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
}

export class SelectTool implements MaskToolController {
  begin(context: MaskToolContext, sample: ImageSample) {
    return success(new RectangleGesture(context, sample.point));
  }

  getHint({ grid }: MaskToolContext) {
    const gridLabel = grid === "mcu" ? "MCUs" : "DCT blocks";
    return {
      text: `Drag to select a rectangle snapped to ${gridLabel}.`,
      keyboard:
        "Arrow keys move one DCT block. Enter starts or completes a rectangle. Escape clears the selection. Ctrl/⌘+A selects the whole image.",
    };
  }

  getInitialCursor(context: MaskToolContext) {
    return getKeyboardStart(context)?.cursor ?? null;
  }

  beginKeyboard(context: MaskToolContext, orientation: JpegOrientation) {
    const start = getKeyboardStart(context);
    return start
      ? new KeyboardRectangle(
          context,
          orientation,
          start.cursor,
          start.columns,
          start.rows,
        )
      : null;
  }
}
