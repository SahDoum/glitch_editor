import type { SpatialMask, SpatialSelection } from "../document/masks";

export function getBrushOverlayPath(
  points: readonly { readonly x: number; readonly y: number }[],
): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function getRectangleSelection(
  mask: SpatialMask | null,
): SpatialSelection | null {
  const shape = mask?.shapes[0];
  if (!shape || shape.kind !== "rectangle") return null;

  return {
    kind: "rectangle",
    coordinateSpace: "image-pixel",
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  };
}
