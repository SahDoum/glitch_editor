import { failure, success, type Result } from "../shared/result";
import type { SpatialMask, SpatialSelection } from "../document/masks";
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

export interface JpegBlockRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface JpegBlockPoint {
  readonly x: number;
  readonly y: number;
}

export type JpegSelectionGrid = "dct" | "mcu";

export interface ImagePoint {
  readonly x: number;
  readonly y: number;
}

export interface JpegSelectionGridCellSize {
  readonly width: number;
  readonly height: number;
}

export interface JpegBlockGeometry {
  readonly width: number;
  readonly height: number;
  readonly components: readonly Pick<
    JpegInspection["components"][number],
    "id" | "horizontalSampling" | "verticalSampling" | "quantizationTable"
  >[];
}

export function snapSelectionToComponentBlocks(
  selection: SpatialSelection,
  inspection: JpegInspection,
  componentId: number,
): Result<SpatialSelection> {
  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  if (!component) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
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
  const blockWidth = (8 * maxHorizontalSampling) / component.horizontalSampling;
  const blockHeight = (8 * maxVerticalSampling) / component.verticalSampling;
  const left = Math.max(0, Math.floor(selection.x / blockWidth) * blockWidth);
  const top = Math.max(0, Math.floor(selection.y / blockHeight) * blockHeight);
  const right = Math.min(
    inspection.width,
    Math.ceil((selection.x + selection.width) / blockWidth) * blockWidth,
  );
  const bottom = Math.min(
    inspection.height,
    Math.ceil((selection.y + selection.height) / blockHeight) * blockHeight,
  );

  return success({
    kind: "rectangle",
    coordinateSpace: "image-pixel",
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function snapSelectionToMcus(
  selection: SpatialSelection,
  inspection: JpegInspection,
): Result<SpatialSelection> {
  if (
    !Number.isFinite(selection.x) ||
    !Number.isFinite(selection.y) ||
    !Number.isFinite(selection.width) ||
    !Number.isFinite(selection.height) ||
    selection.width <= 0 ||
    selection.height <= 0 ||
    inspection.mcuWidth <= 0 ||
    inspection.mcuHeight <= 0
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The image-space selection or MCU geometry is invalid.",
    });
  }

  const left = Math.max(
    0,
    Math.floor(selection.x / inspection.mcuWidth) * inspection.mcuWidth,
  );
  const top = Math.max(
    0,
    Math.floor(selection.y / inspection.mcuHeight) * inspection.mcuHeight,
  );
  const right = Math.min(
    inspection.width,
    Math.ceil((selection.x + selection.width) / inspection.mcuWidth) *
      inspection.mcuWidth,
  );
  const bottom = Math.min(
    inspection.height,
    Math.ceil((selection.y + selection.height) / inspection.mcuHeight) *
      inspection.mcuHeight,
  );

  return success({
    kind: "rectangle",
    coordinateSpace: "image-pixel",
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function getJpegSelectionGridCellSize(
  inspection: JpegInspection,
  componentId: number,
  grid: JpegSelectionGrid,
): Result<JpegSelectionGridCellSize> {
  if (grid === "mcu") {
    if (
      !Number.isFinite(inspection.mcuWidth) ||
      !Number.isFinite(inspection.mcuHeight) ||
      inspection.mcuWidth <= 0 ||
      inspection.mcuHeight <= 0
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "The selected JPEG grid is invalid.",
      });
    }
    return success({
      width: inspection.mcuWidth,
      height: inspection.mcuHeight,
    });
  }

  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  if (!component) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
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
  const width = (8 * maxHorizontalSampling) / component.horizontalSampling;
  const height = (8 * maxVerticalSampling) / component.verticalSampling;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG grid is invalid.",
    });
  }
  return success({ width, height });
}

export function snapImagePointToGrid(
  point: ImagePoint,
  inspection: JpegInspection,
  componentId: number,
  grid: JpegSelectionGrid,
): Result<ImagePoint> {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > inspection.width ||
    point.y > inspection.height
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The brush point is outside the JPEG image.",
    });
  }

  const cellSize = getJpegSelectionGridCellSize(inspection, componentId, grid);
  if (!cellSize.ok) return cellSize;
  const { width: cellWidth, height: cellHeight } = cellSize.value;

  const imageX = Math.min(point.x, Math.max(0, inspection.width - 0.000001));
  const imageY = Math.min(point.y, Math.max(0, inspection.height - 0.000001));
  const cellX = Math.floor(imageX / cellWidth);
  const cellY = Math.floor(imageY / cellHeight);
  const cellLeft = cellX * cellWidth;
  const cellTop = cellY * cellHeight;
  return success({
    x: cellLeft + Math.min(cellWidth, inspection.width - cellLeft) / 2,
    y: cellTop + Math.min(cellHeight, inspection.height - cellTop) / 2,
  });
}

export function getJpegComponentBlockGrid(
  inspection: JpegBlockGeometry,
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

export function mapJpegImagePointToBlock(
  inspection: JpegInspection,
  componentId: number,
  imageX: number,
  imageY: number,
): Result<JpegBlockCoordinate> {
  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  if (
    !component ||
    !Number.isFinite(imageX) ||
    !Number.isFinite(imageY) ||
    imageX < 0 ||
    imageY < 0 ||
    imageX >= inspection.width ||
    imageY >= inspection.height
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected image point or JPEG component is invalid.",
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

  return mapJpegBlockCoordinate(
    inspection,
    componentId,
    Math.floor(
      imageX / ((8 * maxHorizontalSampling) / component.horizontalSampling),
    ),
    Math.floor(
      imageY / ((8 * maxVerticalSampling) / component.verticalSampling),
    ),
  );
}

export function mapJpegImageRectangleToBlockRegion(
  inspection: JpegInspection,
  componentId: number,
  start: ImagePoint,
  end: ImagePoint,
): Result<JpegBlockRegion> {
  const first = mapJpegImagePointToBlock(
    inspection,
    componentId,
    start.x,
    start.y,
  );
  if (!first.ok) return first;
  const last = mapJpegImagePointToBlock(inspection, componentId, end.x, end.y);
  if (!last.ok) return last;
  return success({
    x: Math.min(first.value.blockX, last.value.blockX),
    y: Math.min(first.value.blockY, last.value.blockY),
    width: Math.abs(first.value.blockX - last.value.blockX) + 1,
    height: Math.abs(first.value.blockY - last.value.blockY) + 1,
  });
}

export function mapJpegBlockDragToDestination(
  inspection: JpegInspection,
  componentId: number,
  source: JpegBlockRegion,
  start: ImagePoint,
  end: ImagePoint,
): Result<JpegBlockPoint> {
  if (source.width !== 1 || source.height !== 1) {
    return failure({
      code: "INVALID_INPUT",
      message: "Block repeat requires a single selected source DCT block.",
    });
  }

  const startBlock = mapJpegImagePointToBlock(
    inspection,
    componentId,
    start.x,
    start.y,
  );
  if (!startBlock.ok) return startBlock;
  if (
    startBlock.value.blockX !== source.x ||
    startBlock.value.blockY !== source.y
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "Start the destination drag inside the selected source block.",
    });
  }

  const endBlock = mapJpegImagePointToBlock(
    inspection,
    componentId,
    end.x,
    end.y,
  );
  if (!endBlock.ok) return endBlock;
  const destination = {
    x: source.x + endBlock.value.blockX - startBlock.value.blockX,
    y: source.y + endBlock.value.blockY - startBlock.value.blockY,
  };
  if (destination.x === source.x && destination.y === source.y) {
    return failure({
      code: "INVALID_INPUT",
      message: "Drag the selected source block to a different destination.",
    });
  }
  const destinationBlock = mapJpegBlockCoordinate(
    inspection,
    componentId,
    destination.x,
    destination.y,
  );
  if (!destinationBlock.ok) return destinationBlock;
  return success(destination);
}

export function mapJpegBlockRegionToImageSelection(
  inspection: JpegInspection,
  componentId: number,
  region: JpegBlockRegion,
): Result<SpatialSelection> {
  if (
    !Number.isInteger(region.x) ||
    !Number.isInteger(region.y) ||
    !Number.isInteger(region.width) ||
    !Number.isInteger(region.height) ||
    region.width < 1 ||
    region.height < 1
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected DCT block region is invalid.",
    });
  }
  const first = mapJpegBlockCoordinate(
    inspection,
    componentId,
    region.x,
    region.y,
  );
  if (!first.ok) return first;
  const last = mapJpegBlockCoordinate(
    inspection,
    componentId,
    region.x + region.width - 1,
    region.y + region.height - 1,
  );
  if (!last.ok) return last;
  return success({
    kind: "rectangle",
    coordinateSpace: "image-pixel",
    x: first.value.imageX,
    y: first.value.imageY,
    width: last.value.imageX + last.value.imageWidth - first.value.imageX,
    height: last.value.imageY + last.value.imageHeight - first.value.imageY,
  });
}

export function getMaskBlockCoverage(
  mask: SpatialMask,
  inspection: JpegBlockGeometry,
  componentId: number,
): Result<Uint8Array> {
  if (mask.width !== inspection.width || mask.height !== inspection.height) {
    return failure({
      code: "INVALID_INPUT",
      message: "The spatial mask dimensions do not match the JPEG image.",
    });
  }
  const grid = getJpegComponentBlockGrid(inspection, componentId);
  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  if (!grid || !component) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
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
  const blockWidth = (8 * maxHorizontalSampling) / component.horizontalSampling;
  const blockHeight = (8 * maxVerticalSampling) / component.verticalSampling;
  const coverage = new Uint8Array(grid.columns * grid.rows);

  for (const shape of mask.shapes) {
    if (shape.kind === "rectangle") {
      const startX = Math.max(0, Math.floor(shape.x / blockWidth));
      const startY = Math.max(0, Math.floor(shape.y / blockHeight));
      const endX = Math.min(
        grid.columns,
        Math.ceil((shape.x + shape.width) / blockWidth),
      );
      const endY = Math.min(
        grid.rows,
        Math.ceil((shape.y + shape.height) / blockHeight),
      );
      for (let blockY = startY; blockY < endY; blockY += 1) {
        coverage.fill(
          1,
          blockY * grid.columns + startX,
          blockY * grid.columns + endX,
        );
      }
      continue;
    }

    for (const point of shape.points) {
      const startX = Math.max(
        0,
        Math.floor((point.x - shape.radius) / blockWidth),
      );
      const startY = Math.max(
        0,
        Math.floor((point.y - shape.radius) / blockHeight),
      );
      const endX = Math.min(
        grid.columns,
        Math.floor((point.x + shape.radius) / blockWidth) + 1,
      );
      const endY = Math.min(
        grid.rows,
        Math.floor((point.y + shape.radius) / blockHeight) + 1,
      );

      for (let blockY = startY; blockY < endY; blockY += 1) {
        const top = blockY * blockHeight;
        const bottom = Math.min(inspection.height, top + blockHeight);
        const nearestY = Math.max(top, Math.min(point.y, bottom));
        for (let blockX = startX; blockX < endX; blockX += 1) {
          const left = blockX * blockWidth;
          const right = Math.min(inspection.width, left + blockWidth);
          const nearestX = Math.max(left, Math.min(point.x, right));
          const distanceX = point.x - nearestX;
          const distanceY = point.y - nearestY;
          if (
            distanceX * distanceX + distanceY * distanceY <=
            shape.radius * shape.radius
          ) {
            coverage[blockY * grid.columns + blockX] = 1;
          }
        }
      }
    }
  }

  return success(coverage);
}

export function getMaskBlockCoveragePath(
  mask: SpatialMask,
  inspection: JpegInspection,
  componentId: number,
): Result<string> {
  const coverage = getMaskBlockCoverage(mask, inspection, componentId);
  if (!coverage.ok) return coverage;

  const grid = getJpegComponentBlockGrid(inspection, componentId);
  const cellSize = getJpegSelectionGridCellSize(inspection, componentId, "dct");
  if (!grid) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
    });
  }
  if (!cellSize.ok) return cellSize;

  const path: string[] = [];
  for (let blockY = 0; blockY < grid.rows; blockY += 1) {
    let blockX = 0;
    while (blockX < grid.columns) {
      const rowOffset = blockY * grid.columns;
      while (
        blockX < grid.columns &&
        coverage.value[rowOffset + blockX] === 0
      ) {
        blockX += 1;
      }
      if (blockX === grid.columns) break;

      const firstBlockX = blockX;
      while (
        blockX < grid.columns &&
        coverage.value[rowOffset + blockX] === 1
      ) {
        blockX += 1;
      }
      const left = firstBlockX * cellSize.value.width;
      const right = Math.min(inspection.width, blockX * cellSize.value.width);
      const top = blockY * cellSize.value.height;
      const bottom = Math.min(inspection.height, top + cellSize.value.height);
      path.push(
        `M${left} ${top}h${right - left}v${bottom - top}h${left - right}z`,
      );
    }
  }

  return success(path.join(""));
}

export function getMaskBlockCoverageAtLeastHalf(
  mask: SpatialMask,
  inspection: JpegBlockGeometry,
  componentId: number,
): Result<Uint8Array> {
  const intersecting = getMaskBlockCoverage(mask, inspection, componentId);
  if (!intersecting.ok) return intersecting;
  const grid = getJpegComponentBlockGrid(inspection, componentId);
  const component = inspection.components.find(
    (candidate) => candidate.id === componentId,
  );
  if (!grid || !component) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selected JPEG component is invalid.",
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
  const blockWidth = (8 * maxHorizontalSampling) / component.horizontalSampling;
  const blockHeight = (8 * maxVerticalSampling) / component.verticalSampling;
  const selected = new Uint8Array(intersecting.value.length);
  const shape = mask.shapes[0];
  if (!shape) return success(selected);

  if (shape.kind === "rectangle") {
    for (let blockY = 0; blockY < grid.rows; blockY += 1) {
      const top = blockY * blockHeight;
      const bottom = Math.min(inspection.height, top + blockHeight);
      for (let blockX = 0; blockX < grid.columns; blockX += 1) {
        const index = blockY * grid.columns + blockX;
        if (intersecting.value[index] === 0) continue;
        const left = blockX * blockWidth;
        const right = Math.min(inspection.width, left + blockWidth);
        const overlapWidth = Math.max(
          0,
          Math.min(right, shape.x + shape.width) - Math.max(left, shape.x),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(bottom, shape.y + shape.height) - Math.max(top, shape.y),
        );
        const visibleArea = (right - left) * (bottom - top);
        if (overlapWidth * overlapHeight >= visibleArea / 2) {
          selected[index] = 1;
        }
      }
    }
    return success(selected);
  }

  const candidateCount = intersecting.value.reduce(
    (count, value) => count + value,
    0,
  );
  const coverageWork = candidateCount * 64 * shape.points.length;
  if (!Number.isSafeInteger(coverageWork) || coverageWork > 50_000_000) {
    return failure({
      code: "PROCESSING_FAILED",
      message:
        "The block-permutation mask is too complex to measure safely. Use a smaller brush mask or a rectangular selection.",
    });
  }

  for (let blockY = 0; blockY < grid.rows; blockY += 1) {
    const top = blockY * blockHeight;
    const bottom = Math.min(inspection.height, top + blockHeight);
    for (let blockX = 0; blockX < grid.columns; blockX += 1) {
      const index = blockY * grid.columns + blockX;
      if (intersecting.value[index] === 0) continue;
      const left = blockX * blockWidth;
      const right = Math.min(inspection.width, left + blockWidth);
      let coveredSamples = 0;
      for (let sampleY = 0; sampleY < 8; sampleY += 1) {
        const y = top + ((sampleY + 0.5) * (bottom - top)) / 8;
        for (let sampleX = 0; sampleX < 8; sampleX += 1) {
          const x = left + ((sampleX + 0.5) * (right - left)) / 8;
          if (
            shape.points.some((point) => {
              const distanceX = point.x - x;
              const distanceY = point.y - y;
              return (
                distanceX * distanceX + distanceY * distanceY <=
                shape.radius * shape.radius
              );
            })
          ) {
            coveredSamples += 1;
          }
        }
      }
      if (coveredSamples >= 32) selected[index] = 1;
    }
  }
  return success(selected);
}
