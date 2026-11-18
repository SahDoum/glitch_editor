import type { JpegBlockRegion } from "../../../jpeg/block-geometry";
import { WHOLE_IMAGE_TOOLBAR } from "../../effects/mask-tools";
import { field } from "../../effects/operation-fields";
import type { EffectView } from "../../effects/types";
import type { BlockPoint } from "../block-geometry-helpers";
import { BlockTransformFrame } from "../block-transform.shared";

export interface BlockRepeatSettings {
  readonly count: number;
  readonly source: JpegBlockRegion | null;
  readonly draft: JpegBlockRegion | null;
  readonly destination: BlockPoint | null;
}

export const NO_BLOCK_REPEAT_SOURCE = {
  source: null,
  draft: null,
  destination: null,
} satisfies Partial<BlockRepeatSettings>;

export const BlockRepeatView: EffectView<BlockRepeatSettings> = {
  id: "block-repeat",
  label: "Block Repeat",
  description: "Repeat a source region at a dragged destination.",
  category: "Blocks",
  iconPaths: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  interaction: "gesture",
  toolbar: WHOLE_IMAGE_TOOLBAR,
  autoApply: false,
  autoPreview: false,
  defaultSettings: { count: 1, ...NO_BLOCK_REPEAT_SOURCE },
  operation: {
    kinds: ["block-repeat"],
    title: "Block copy / repeat",
    describe: (parameters) => (
      <>
        Component {field(parameters, "componentIndex")} · source (
        {field(parameters, "sourceX")}, {field(parameters, "sourceY")}) · offset
        ({field(parameters, "offsetX")}, {field(parameters, "offsetY")}) ·{" "}
        {field(parameters, "repetitions")} copies
      </>
    ),
  },
  getTopBarActions: (settings) => [
    {
      id: "reset-source",
      label: "New source",
      title: "Choose a new source block (R)",
      shortcut: "R",
      disabled: !settings.source && !settings.draft,
      patch: NO_BLOCK_REPEAT_SOURCE,
    },
  ],
  resetForComponentChange: (settings) => ({
    ...settings,
    ...NO_BLOCK_REPEAT_SOURCE,
  }),
  Panel({ settings, editor, onChangeSettings }) {
    const { source, destination } = settings;
    return (
      <BlockTransformFrame editor={editor} requiresMask={false}>
        {source && (
          <p className="selection-readout">
            Source block ({source.x}, {source.y})
          </p>
        )}
        {destination && source && (
          <p className="selection-readout">
            First destination ({destination.x}, {destination.y}) · offset (
            {destination.x - source.x}, {destination.y - source.y}) blocks
          </p>
        )}
        <label className="coefficient-field tool-field">
          <span>Repeated destinations</span>
          <input
            type="number"
            min="1"
            max="256"
            step="1"
            value={settings.count}
            onChange={(event) =>
              onChangeSettings({ count: Number(event.currentTarget.value) })
            }
          />
        </label>
        <button
          className="operation-button"
          type="button"
          disabled={editor.isEncoding || !source || !destination}
          onClick={() => editor.apply()}
        >
          Apply block repeat
        </button>
      </BlockTransformFrame>
    );
  },
};
