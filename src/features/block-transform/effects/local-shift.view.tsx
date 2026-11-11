import { MASK_EFFECT_TOOLBAR } from "../../effects/mask-tools";
import { field } from "../../effects/operation-fields";
import type { EffectView } from "../../effects/types";
import { BlockTransformFrame } from "../block-transform.shared";

export interface LocalShiftSettings {
  readonly x: number;
  readonly y: number;
}

export const LocalShiftView: EffectView<LocalShiftSettings> = {
  id: "local-shift",
  label: "Local Shift",
  description: "Copy nearby component blocks into the selected mask.",
  category: "Blocks",
  iconPaths: [
    "M4 4h6v6H4z",
    "M14 14h6v6h-6z",
    "M10 7h5",
    "m12 4 3 3-3 3",
    "M14 17H9",
    "m12 14-3 3 3 3",
  ],
  interaction: "mask",
  toolbar: MASK_EFFECT_TOOLBAR,
  autoApply: true,
  autoPreview: false,
  defaultSettings: { x: 1, y: 0 },
  operation: {
    kinds: ["block-shift"],
    title: "Local block shift",
    describe: (parameters) => (
      <>
        Component {field(parameters, "componentIndex")} · offset (
        {field(parameters, "offsetX")}, {field(parameters, "offsetY")}) blocks
      </>
    ),
  },
  Panel({ settings, editor, onChangeSettings }) {
    return (
      <BlockTransformFrame editor={editor} requiresMask>
        <p className="operation-description">
          Copy whole DCT blocks from the selected component into masked
          destinations, shifted by component blocks. Choose a chroma component
          for a color shift. Source blocks outside the image leave destinations
          unchanged. At least 50% mask coverage is required.
        </p>
        <label className="coefficient-field tool-field">
          <span>Horizontal offset in component blocks</span>
          <input
            type="number"
            min="-256"
            max="256"
            step="1"
            value={settings.x}
            onChange={(event) =>
              onChangeSettings({ x: Number(event.currentTarget.value) })
            }
          />
        </label>
        <label className="coefficient-field tool-field">
          <span>Vertical offset in component blocks</span>
          <input
            type="number"
            min="-256"
            max="256"
            step="1"
            value={settings.y}
            onChange={(event) =>
              onChangeSettings({ y: Number(event.currentTarget.value) })
            }
          />
        </label>
        <button
          className="operation-button secondary"
          type="button"
          disabled={!editor.hasMask || editor.isEncoding || editor.isPreviewing}
          onClick={() => editor.preview()}
        >
          {editor.isPreviewing ? "Previewing…" : "Preview"}
        </button>
        <button
          className="operation-button"
          type="button"
          disabled={!editor.hasMask || editor.isEncoding}
          onClick={() => editor.apply()}
        >
          Shift blocks in mask
        </button>
      </BlockTransformFrame>
    );
  },
};
