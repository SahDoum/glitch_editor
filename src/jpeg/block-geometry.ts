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
