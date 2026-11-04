import { failure, success, type Result } from "../shared/result";
import type { JpegInspection } from "./inspect";

export interface JpegBlockCoordinate {
  componentId: number;
  blockX: number;
  blockY: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  mcuX: number;
  mcuY: number;
  blockInMcuX: number;
  blockInMcuY: number;
}

export interface JpegComponentBlockGrid {
  columns: number;
  rows: number;
}

export function getJpegComponentBlockGrid(
  inspection: JpegInspection,
  componentId: number,
): JpegComponentBlockGrid | null {
  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  if (!component) return null;

  const maxHorizontalSampling = Math.max(
    ...inspection.components.map(
      ({ horizontalSampling }) => horizontalSampling,
    ),
  );
  const maxVerticalSampling = Math.max(
    ...inspection.components.map(({ verticalSampling }) => verticalSampling),
  );
  return {
    columns: Math.ceil(
      (inspection.width * component.horizontalSampling) /
        (8 * maxHorizontalSampling),
    ),
    rows: Math.ceil(
      (inspection.height * component.verticalSampling) /
        (8 * maxVerticalSampling),
    ),
  };
}

export function mapJpegBlockCoordinate(
  inspection: JpegInspection,
  componentId: number,
  blockX: number,
  blockY: number,
): Result<JpegBlockCoordinate> {
  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  const blockGrid = getJpegComponentBlockGrid(inspection, componentId);
  if (
    !component ||
    !blockGrid ||
    !Number.isInteger(blockX) ||
    !Number.isInteger(blockY) ||
    blockX < 0 ||
    blockY < 0 ||
    blockX >= blockGrid.columns ||
    blockY >= blockGrid.rows
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected component or DCT block coordinate is invalid.",
    });
  }

  const maxHorizontalSampling = Math.max(
    ...inspection.components.map(
      ({ horizontalSampling }) => horizontalSampling,
    ),
  );
  const maxVerticalSampling = Math.max(
    ...inspection.components.map(({ verticalSampling }) => verticalSampling),
  );
  const imageX =
    (blockX * 8 * maxHorizontalSampling) / component.horizontalSampling;
  const imageY =
    (blockY * 8 * maxVerticalSampling) / component.verticalSampling;
  const blockImageWidth =
    (8 * maxHorizontalSampling) / component.horizontalSampling;
  const blockImageHeight =
    (8 * maxVerticalSampling) / component.verticalSampling;

  return success({
    componentId,
    blockX,
    blockY,
    imageX,
    imageY,
    imageWidth: Math.max(
      0,
      Math.min(blockImageWidth, inspection.width - imageX),
    ),
    imageHeight: Math.max(
      0,
      Math.min(blockImageHeight, inspection.height - imageY),
    ),
    mcuX: Math.floor(blockX / component.horizontalSampling),
    mcuY: Math.floor(blockY / component.verticalSampling),
    blockInMcuX: blockX % component.horizontalSampling,
    blockInMcuY: blockY % component.verticalSampling,
  });
}
