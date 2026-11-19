import type { ComponentType } from "react";
import type { JpegSelectionGrid } from "../../jpeg/block-geometry";
import { RadioChoiceGroup } from "../../ui/tool-controls";

export interface MaskToolSettingsProps {
  readonly brushSize: number;
  readonly onChangeBrushSize: (size: number) => void;
  readonly maskGrid: JpegSelectionGrid;
  readonly onChangeMaskGrid: (grid: JpegSelectionGrid) => void;
  readonly showSnapGrid: boolean;
}

export interface MaskToolView {
  readonly label: string;
  readonly shortcut: string;
  readonly iconPaths: readonly string[];
  readonly iconStrokeDasharray?: string;
  readonly Settings?: ComponentType<MaskToolSettingsProps>;
}

function SnapGrid({
  maskGrid,
  onChangeMaskGrid,
  showSnapGrid,
}: MaskToolSettingsProps) {
  if (!showSnapGrid) return null;
  return (
    <RadioChoiceGroup<JpegSelectionGrid>
      name="canvas-mask-snap-grid"
      legend="Snap"
      value={maskGrid}
      options={[
        { value: "dct", label: "DCT" },
        { value: "mcu", label: "MCU" },
      ]}
      onChange={onChangeMaskGrid}
      layout="inline"
      showCheckmark={false}
    />
  );
}

function BrushSettings(props: MaskToolSettingsProps) {
  const { brushSize, onChangeBrushSize } = props;
  return (
    <>
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
      <SnapGrid {...props} />
    </>
  );
}

export const AllToolView: MaskToolView = {
  label: "All",
  shortcut: "A",
  iconPaths: ["M5 3h10l4 4v14H5z", "M15 3v5h4"],
};

export const BrushToolView: MaskToolView = {
  label: "Brush",
  shortcut: "B",
  iconPaths: ["m4 16 9-9 4 4-9 9H4v-4Z", "m12 8 3-3 4 4-3 3", "M4 21h7"],
  Settings: BrushSettings,
};

export const SelectToolView: MaskToolView = {
  label: "Select",
  shortcut: "M",
  iconPaths: ["M4 4h16v16H4z"],
  iconStrokeDasharray: "3 3",
  Settings: SnapGrid,
};
