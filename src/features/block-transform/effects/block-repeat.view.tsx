import { EffectActions } from "../../../ui/effect-actions";
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
  label: "Repeat Blocks",
  description: "Repeats a block along the chosen direction.",
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
      label: "Choose another source",
      title: "Choose another source block",
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
    const invalid =
      !Number.isInteger(settings.count) ||
      settings.count < 1 ||
      settings.count > 256;
    return (
      <BlockTransformFrame
        editor={editor}
        advanced={
          source && (
            <p className="selection-readout">
              Source ({source.x}, {source.y})
              {destination &&
                ` · offset (${destination.x - source.x}, ${destination.y - source.y}) blocks`}
            </p>
          )
        }
        actions={
          <EffectActions
            onApply={() => editor.apply()}
            disabled={!editor.canApply || editor.hasScanCorruption}
          />
        }
      >
        <label className="coefficient-field tool-field">
          <span>Copies</span>
          <input
            type="number"
            min="1"
            max="256"
            step="1"
            value={settings.count}
            aria-invalid={invalid}
            aria-describedby={invalid ? "repeat-count-error" : undefined}
            onChange={(event) =>
              onChangeSettings({ count: Number(event.currentTarget.value) })
            }
          />
        </label>
        {invalid && (
          <p id="repeat-count-error" className="field-error" role="status">
            Enter a whole number from 1 to 256.
          </p>
        )}
      </BlockTransformFrame>
    );
  },
};
