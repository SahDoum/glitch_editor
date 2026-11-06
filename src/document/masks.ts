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
  readonly shapes: readonly SpatialMaskShape[];
}

export interface NamedSpatialMask {
  readonly name: string;
  readonly mask: SpatialMask;
}

export type SpatialMaskShape =
  | {
      readonly kind: "rectangle";
      readonly mode: "add";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "brush";
      readonly mode: "add";
      readonly radius: number;
      readonly points: readonly { readonly x: number; readonly y: number }[];
    };

const MAX_BRUSH_POINTS = 10_000;

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

export function createBrushMask(
  points: readonly { readonly x: number; readonly y: number }[],
  radius: number,
  imageWidth: number,
  imageHeight: number,
): Result<SpatialMask> {
  if (
    !isValidDimensions(imageWidth, imageHeight) ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius > 512 ||
    points.length === 0 ||
    points.length > MAX_BRUSH_POINTS ||
    !points.every(
      ({ x, y }) =>
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= 0 &&
        y >= 0 &&
        x <= imageWidth &&
        y <= imageHeight,
    )
  ) {
    return failure({
      code: "INVALID_INPUT",
      message: "The image-space brush mask is invalid.",
    });
  }

  return success(
    Object.freeze({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      width: imageWidth,
      height: imageHeight,
      shapes: Object.freeze([
        Object.freeze({
          kind: "brush" as const,
          mode: "add" as const,
          radius,
          points: Object.freeze(
            points.map((point) => Object.freeze({ ...point })),
          ),
        }),
      ]),
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSpatialMask(value: unknown): value is SpatialMask {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !isValidDimensions(width, height) ||
    !Array.isArray(value.shapes) ||
    value.shapes.length !== 1
  ) {
    return false;
  }

  const shape = value.shapes[0];
  if (!isRecord(shape) || shape.mode !== "add") return false;

  if (shape.kind === "rectangle") {
    if (
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
      shape.x + shape.width <= width &&
      shape.y + shape.height <= height
    );
  }

  return (
    shape.kind === "brush" &&
    typeof shape.radius === "number" &&
    Number.isFinite(shape.radius) &&
    shape.radius > 0 &&
    shape.radius <= 512 &&
    Array.isArray(shape.points) &&
    shape.points.length > 0 &&
    shape.points.length <= MAX_BRUSH_POINTS &&
    shape.points.every(
      (point) =>
        isRecord(point) &&
        typeof point.x === "number" &&
        typeof point.y === "number" &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= width &&
        point.y <= height,
    )
  );
}

export function getMaskFromParameters(value: unknown): SpatialMask | null {
  if (!isRecord(value)) return null;
  return isSpatialMask(value.mask) ? value.mask : null;
}

export function copySpatialMask(mask: SpatialMask): Result<SpatialMask> {
  if (!isSpatialMask(mask)) {
    return failure({
      code: "INVALID_INPUT",
      message: "The mask snapshot is invalid.",
    });
  }
  const shape = mask.shapes[0]!;
  if (shape.kind === "brush") {
    return createBrushMask(shape.points, shape.radius, mask.width, mask.height);
  }
  return createSpatialMask(
    {
      kind: "rectangle",
      coordinateSpace: "image-pixel",
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
    },
    mask.width,
    mask.height,
  );
}

export function spatialMaskToJson(mask: SpatialMask): JsonValue {
  return {
    schemaVersion: mask.schemaVersion,
    id: mask.id,
    width: mask.width,
    height: mask.height,
    shapes: mask.shapes.map((shape) => ({
      ...shape,
      ...(shape.kind === "brush"
        ? {
            points: shape.points.map((point) => ({
              x: point.x,
              y: point.y,
            })),
          }
        : {}),
    })),
  };
}

export function spatialMaskParameters(mask: SpatialMask): JsonValue {
  return { mask: spatialMaskToJson(mask) };
}

export function namedSpatialMaskParameters(
  name: string,
  mask: SpatialMask,
): JsonValue {
  return {
    name: name.trim(),
    mask: spatialMaskToJson(mask),
  };
}

export function isValidMaskName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 48
  );
}
