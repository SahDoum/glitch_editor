import {
  previewDimensions,
  previewOrientationTransform,
} from "../application/preview-orientation";
import type { SpatialMask, SpatialSelection } from "../document/masks";
import type { ImagePoint } from "../features/effects/types";
import {
  getMaskBlockCoveragePath,
  type JpegBlockCoordinate,
} from "../jpeg/block-geometry";
import type { JpegInspection } from "../jpeg/inspect";
import type { JpegOrientation } from "../jpeg/orientation";

export function ImageOverlays({
  inspection,
  orientation,
  showBlocks,
  showMcus,
  selection,
  mask,
  brushDraft,
  brushCursorPoint,
  brushRadius,
  componentId,
  keyboardCursor,
  gestureSource,
  gestureSourceLabel,
  gestureSourceInvalid,
  gestureDestinations,
  gestureDestinationInvalid,
}: {
  inspection: JpegInspection;
  orientation: JpegOrientation;
  showBlocks: boolean;
  showMcus: boolean;
  selection: SpatialSelection | null;
  mask: SpatialMask | null;
  brushDraft: readonly (readonly ImagePoint[])[];
  brushCursorPoint: ImagePoint | null;
  brushRadius: number;
  componentId: number;
  keyboardCursor: JpegBlockCoordinate | null;
  gestureSource: SpatialSelection | null;
  gestureSourceLabel?: string;
  gestureSourceInvalid: boolean;
  gestureDestinations: readonly SpatialSelection[];
  gestureDestinationInvalid: boolean;
}) {
  const blockPatternWidth = inspection.blockWidth;
  const blockPatternHeight = inspection.blockHeight;
  const hasActiveBrush =
    mask?.width === inspection.width && mask.height === inspection.height
      ? mask.shapes.some((shape) => shape.kind === "brush")
      : false;
  const activeBrushCoverage =
    mask && hasActiveBrush
      ? getMaskBlockCoveragePath(mask, inspection, componentId)
      : null;
  const brushPoints = brushDraft.flat();
  const draftBrushMask: SpatialMask | null =
    brushPoints.length > 0
      ? {
          schemaVersion: 1,
          id: "brush-draft",
          width: inspection.width,
          height: inspection.height,
          shapes: [
            {
              kind: "brush",
              mode: "add",
              radius: brushRadius,
              points: brushPoints,
            },
          ],
        }
      : null;
  const draftBrushCoverage = draftBrushMask
    ? getMaskBlockCoveragePath(draftBrushMask, inspection, componentId)
    : null;

  const dimensions = previewDimensions(inspection, orientation);
  return (
    <svg
      className="image-overlays"
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g
        transform={previewOrientationTransform(
          inspection.width,
          inspection.height,
          orientation,
        )}
      >
        <defs>
          <pattern
            id="block-grid"
            width={blockPatternWidth}
            height={blockPatternHeight}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${blockPatternWidth} 0 V ${blockPatternHeight} M 0 ${blockPatternHeight} H ${blockPatternWidth}`}
              fill="none"
              stroke="#c8f169"
              strokeOpacity="0.62"
              strokeWidth="0.45"
            />
          </pattern>
          <pattern
            id="mcu-grid"
            width={inspection.mcuWidth}
            height={inspection.mcuHeight}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${inspection.mcuWidth} 0 V ${inspection.mcuHeight} M 0 ${inspection.mcuHeight} H ${inspection.mcuWidth}`}
              fill="none"
              stroke="#ff9b72"
              strokeOpacity="0.9"
              strokeWidth="0.9"
            />
          </pattern>
        </defs>
        {showBlocks && (
          <rect
            width={inspection.width}
            height={inspection.height}
            fill="url(#block-grid)"
          />
        )}
        {showMcus && (
          <rect
            width={inspection.width}
            height={inspection.height}
            fill="url(#mcu-grid)"
          />
        )}
        {activeBrushCoverage?.ok && (
          <path className="active-mask-cells" d={activeBrushCoverage.value} />
        )}
        {selection && (
          <rect
            className="selection-overlay"
            x={selection.x}
            y={selection.y}
            width={selection.width}
            height={selection.height}
          />
        )}
        {gestureSource && (
          <rect
            className={`block-transfer-source-overlay ${gestureSourceInvalid ? "is-invalid" : ""}`}
            x={gestureSource.x}
            y={gestureSource.y}
            width={gestureSource.width}
            height={gestureSource.height}
          />
        )}
        {gestureSource && gestureSourceLabel && (
          <text
            className="block-source-label"
            x={gestureSource.x + 2}
            y={Math.max(9, gestureSource.y - 2)}
            fontSize={Math.max(
              8,
              Math.min(inspection.width, inspection.height) / 52,
            )}
          >
            {gestureSourceLabel}
          </text>
        )}
        {gestureDestinations.map((destination, index) => (
          <rect
            key={index}
            className={`block-transfer-target-overlay ${gestureDestinationInvalid ? "is-invalid" : ""}`}
            x={destination.x}
            y={destination.y}
            width={destination.width}
            height={destination.height}
          />
        ))}
        {draftBrushCoverage?.ok && (
          <path className="brush-draft-cells" d={draftBrushCoverage.value} />
        )}
        {brushCursorPoint && (
          <>
            <circle
              className="brush-cursor-outline"
              cx={brushCursorPoint.x}
              cy={brushCursorPoint.y}
              r={brushRadius}
            />
            <circle
              className="brush-cursor"
              cx={brushCursorPoint.x}
              cy={brushCursorPoint.y}
              r={brushRadius}
            />
          </>
        )}
        {keyboardCursor && (
          <rect
            className="keyboard-cursor-overlay"
            x={keyboardCursor.imageX}
            y={keyboardCursor.imageY}
            width={keyboardCursor.imageWidth}
            height={keyboardCursor.imageHeight}
          />
        )}
      </g>
    </svg>
  );
}
