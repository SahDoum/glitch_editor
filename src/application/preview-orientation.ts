import { readJpegOrientation, type JpegOrientation } from "../jpeg/orientation";
import type { JpegInspection } from "../jpeg/inspect";

export { readJpegOrientation };

export function previewDimensions(
  inspection: Pick<JpegInspection, "width" | "height">,
  orientation: JpegOrientation,
): { width: number; height: number } {
  return orientation >= 5
    ? { width: inspection.height, height: inspection.width }
    : { width: inspection.width, height: inspection.height };
}

export function previewOrientationTransform(
  width: number,
  height: number,
  orientation: JpegOrientation,
): string {
  switch (orientation) {
    case 1:
      return "matrix(1 0 0 1 0 0)";
    case 2:
      return `matrix(-1 0 0 1 ${width} 0)`;
    case 3:
      return `matrix(-1 0 0 -1 ${width} ${height})`;
    case 4:
      return `matrix(1 0 0 -1 0 ${height})`;
    case 5:
      return "matrix(0 1 1 0 0 0)";
    case 6:
      return `matrix(0 1 -1 0 ${height} 0)`;
    case 7:
      return `matrix(0 -1 -1 0 ${height} ${width})`;
    case 8:
      return `matrix(0 -1 1 0 0 ${width})`;
  }
}

export function previewPointToFrame(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: JpegOrientation,
): { x: number; y: number } {
  switch (orientation) {
    case 1:
      return { x, y };
    case 2:
      return { x: width - x, y };
    case 3:
      return { x: width - x, y: height - y };
    case 4:
      return { x, y: height - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: y, y: height - x };
    case 7:
      return { x: width - y, y: height - x };
    case 8:
      return { x: width - y, y: x };
  }
}
