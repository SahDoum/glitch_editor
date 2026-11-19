import type { CanvasToolControlsProps } from "./registry";

export function BrushControls({
  brushSize,
  onChangeBrushSize,
}: CanvasToolControlsProps) {
  return (
    <label className="canvas-context-field">
      <span>Brush · {brushSize} image px</span>
      <input
        type="range"
        min="4"
        max="256"
        step="4"
        value={brushSize}
        onChange={(event) =>
          onChangeBrushSize(Number(event.currentTarget.value))
        }
      />
    </label>
  );
}
