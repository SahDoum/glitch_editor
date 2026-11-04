import { failure, success, type Result } from "../shared/result";
import type { JsonValue } from "../operations/schema";

export interface SpatialSelection {
  readonly kind: "rectangle";
  readonly coordinateSpace: "image-pixel";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpatialMask {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly {
    readonly kind: "rectangle";
    readonly mode: "add";
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

function isValidDimensions(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0
  );
}

export function isSpatialSelection(
  value: unknown,
  imageWidth: number,
  imageHeight: number,
): value is SpatialSelection {
  if (
    !isValidDimensions(imageWidth, imageHeight) ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const selection = value as Record<string, unknown>;
  return (
    selection.kind === "rectangle" &&
    selection.coordinateSpace === "image-pixel" &&
    typeof selection.x === "number" &&
    typeof selection.y === "number" &&
    typeof selection.width === "number" &&
    typeof selection.height === "number" &&
    [selection.x, selection.y, selection.width, selection.height].every(
      Number.isFinite,
    ) &&
    selection.x >= 0 &&
    selection.y >= 0 &&
    selection.width > 0 &&
    selection.height > 0 &&
    selection.x + selection.width <= imageWidth &&
    selection.y + selection.height <= imageHeight
  );
}

export function createRectangleSelection(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  imageWidth: number,
  imageHeight: number,
): Result<SpatialSelection | null> {
  if (
    !isValidDimensions(imageWidth, imageHeight) ||
    ![startX, startY, endX, endY].every(Number.isFinite)
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The image-space selection coordinates are invalid.",
    });
  }

  const left = Math.max(0, Math.min(imageWidth, Math.min(startX, endX)));
  const top = Math.max(0, Math.min(imageHeight, Math.min(startY, endY)));
  const right = Math.max(0, Math.min(imageWidth, Math.max(startX, endX)));
  const bottom = Math.max(0, Math.min(imageHeight, Math.max(startY, endY)));
  if (right <= left || bottom <= top) return success(null);

  return success(
    Object.freeze({
      kind: "rectangle",
      coordinateSpace: "image-pixel",
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }),
  );
}

export function createSpatialMask(
  selection: SpatialSelection,
  imageWidth: number,
  imageHeight: number,
): Result<SpatialMask> {
  if (!isSpatialSelection(selection, imageWidth, imageHeight)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The selection cannot be represented as an image-space mask.",
    });
  }

  const shape = Object.freeze({
    kind: "rectangle" as const,
    mode: "add" as const,
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  });

  return success(
    Object.freeze({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      width: imageWidth,
      height: imageHeight,
      shapes: Object.freeze([shape]),
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSpatialMask(value: unknown): value is SpatialMask {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !isValidDimensions(value.width, value.height) ||
    !Array.isArray(value.shapes) ||
    value.shapes.length !== 1
  ) {
    return false;
  }

  const shape = value.shapes[0];
  if (
    !isRecord(shape) ||
    shape.kind !== "rectangle" ||
    shape.mode !== "add" ||
    typeof shape.x !== "number" ||
    typeof shape.y !== "number" ||
    typeof shape.width !== "number" ||
    typeof shape.height !== "number" ||
    ![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite)
  ) {
    return false;
  }

  return (
    shape.x >= 0 &&
    shape.y >= 0 &&
    shape.width > 0 &&
    shape.height > 0 &&
    shape.x + shape.width <= value.width &&
    shape.y + shape.height <= value.height
  );
}

export function getMaskFromParameters(value: unknown): SpatialMask | null {
  if (!isRecord(value)) return null;
  return isSpatialMask(value.mask) ? value.mask : null;
}

export function spatialMaskParameters(mask: SpatialMask): JsonValue {
  return {
    mask: {
      schemaVersion: mask.schemaVersion,
      id: mask.id,
      width: mask.width,
      height: mask.height,
      shapes: mask.shapes.map((shape) => ({
        kind: shape.kind,
        mode: shape.mode,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      })),
    },
  };
}
