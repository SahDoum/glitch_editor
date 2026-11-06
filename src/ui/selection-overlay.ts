import type { SpatialMask, SpatialSelection } from "../document/masks";

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
