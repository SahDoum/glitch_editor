import {
  mapJpegBlockRegionToImageSelection,
  mapJpegImagePointToBlock,
  mapJpegImageRectangleToBlockRegion,
  mapJpegImageRectangleToBlockRegionClipped,
  type JpegBlockRegion,
} from "../../jpeg/block-geometry";
import type { JpegInspection } from "../../jpeg/inspect";
import type { SpatialSelection } from "../../document/masks";
import { MAX_BLOCK_TRANSFER_BLOCKS } from "../../operations/jpeg-glitch";
import {
  failure,
  success,
  type AppError,
  type Result,
} from "../../shared/result";
import type { ImagePoint } from "../effects/types";

export interface BlockPoint {
  readonly x: number;
  readonly y: number;
}

function getComponent(inspection: JpegInspection, componentIndex: number) {
  return inspection.components[componentIndex] ?? null;
}

const INVALID_COMPONENT = failure<AppError>({
  code: "INVALID_INPUT",
  message: "The selected JPEG component is invalid.",
});

/** Image pixels to a DCT block coordinate of one component. */
export function getComponentBlockPoint(
  inspection: JpegInspection,
  componentIndex: number,
  point: ImagePoint,
): Result<BlockPoint> {
  const component = getComponent(inspection, componentIndex);
  if (!component) return INVALID_COMPONENT;
  const coordinate = mapJpegImagePointToBlock(
    inspection,
    component.id,
    point.x,
    point.y,
  );
  return coordinate.ok
    ? success({ x: coordinate.value.blockX, y: coordinate.value.blockY })
    : coordinate;
}

export function getBlockRegionFromDrag(
  inspection: JpegInspection,
  componentIndex: number,
  start: ImagePoint,
  end: ImagePoint,
  { allowOversized = false, clipToImage = false } = {},
): Result<JpegBlockRegion> {
  const component = getComponent(inspection, componentIndex);
  if (!component) return INVALID_COMPONENT;
  const mapped = clipToImage
    ? mapJpegImageRectangleToBlockRegionClipped(
        inspection,
        component.id,
        start,
        end,
      )
    : mapJpegImageRectangleToBlockRegion(inspection, component.id, start, end);
  if (!mapped.ok) return mapped;
  if (
    !allowOversized &&
    mapped.value.width * mapped.value.height > MAX_BLOCK_TRANSFER_BLOCKS
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected block region exceeds the bounded transfer size.",
    });
  }
  return mapped;
}

export function getBlockRegionSelection(
  inspection: JpegInspection,
  componentIndex: number,
  region: JpegBlockRegion | null,
): SpatialSelection | null {
  const component = getComponent(inspection, componentIndex);
  if (!region || !component) return null;
  const mapped = mapJpegBlockRegionToImageSelection(
    inspection,
    component.id,
    region,
  );
  return mapped.ok ? mapped.value : null;
}
