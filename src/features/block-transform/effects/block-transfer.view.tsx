import { EffectActions } from "../../../ui/effect-actions";
import type { JpegBlockRegion } from "../../../jpeg/block-geometry";
import type {
  BlockTransferAction,
  BlockTransferMode,
} from "../../../operations/jpeg-glitch";
import { RadioChoiceGroup } from "../../../ui/tool-controls";
import { WHOLE_IMAGE_TOOLBAR } from "../../effects/mask-tools";
import { field } from "../../effects/operation-fields";
import type { EffectView } from "../../effects/types";
import type { BlockPoint } from "../block-geometry-helpers";
import { BlockTransformFrame } from "../block-transform.shared";

export interface BlockTransferSettings {
  readonly mode: BlockTransferMode;
  readonly action: BlockTransferAction;
  readonly applyOnDrop: boolean;
  readonly source: JpegBlockRegion | null;
  /** Source rectangle while it is being dragged. */
  readonly draft: JpegBlockRegion | null;
  readonly draftOutOfBounds: boolean;
  readonly destination: BlockPoint | null;
}

export const NO_BLOCK_TRANSFER_SOURCE = {
  source: null,
  draft: null,
  draftOutOfBounds: false,
  destination: null,
} satisfies Partial<BlockTransferSettings>;

export const BlockTransferView: EffectView<BlockTransferSettings> = {
  id: "block-transfer",
  label: "Transfer Blocks",
  description: "Copies or swaps a region of JPEG blocks.",
  category: "Blocks",
  iconPaths: ["M14 6v-2H2v16h12v-2", "M9 10h8V7l6 5-6 5v-3H9z"],
  interaction: "gesture",
  toolbar: WHOLE_IMAGE_TOOLBAR,
  autoApply: false,
  autoPreview: false,
  defaultSettings: {
    mode: "all",
    action: "copy",
    applyOnDrop: false,
    ...NO_BLOCK_TRANSFER_SOURCE,
  },
  operation: {
    kinds: ["block-transfer"],
    title: "Block region transfer",
    describe: (parameters) => (
      <>
        Component {field(parameters, "componentIndex")} ·{" "}
        {field(parameters, "action")} {field(parameters, "mode")} · source (
        {field(parameters, "sourceX")}, {field(parameters, "sourceY")}) ·{" "}
        {field(parameters, "width")} × {field(parameters, "height")} blocks ·
        destination ({field(parameters, "destinationX")},{" "}
        {field(parameters, "destinationY")})
      </>
    ),
  },
  getTopBarActions: (settings) => [
    {
      id: "reset-source",
      label: "Choose another source",
      title: "Choose another source region",
      shortcut: "R",
      disabled: !settings.source && !settings.draft,
      patch: NO_BLOCK_TRANSFER_SOURCE,
    },
  ],
  resetForComponentChange: (settings) => ({
    ...settings,
    ...NO_BLOCK_TRANSFER_SOURCE,
  }),
  Panel({ settings, editor, onChangeSettings }) {
    return (
      <BlockTransformFrame
        editor={editor}
        advanced={
          <>
            <RadioChoiceGroup<BlockTransferMode>
              name="block-transfer-data"
              legend="Coefficient data"
              value={settings.mode}
              options={[
                { value: "all", label: "Whole block", hint: "DC + AC" },
                { value: "dc", label: "DC only" },
                { value: "ac", label: "AC only" },
              ]}
              onChange={(mode) => onChangeSettings({ mode })}
              layout="triple"
            />
            <p className="coefficient-note">
              Copying luminance transfers brightness structure. The destination
              can retain a different color.
            </p>
          </>
        }
        actions={
          <EffectActions
            onApply={() => editor.apply()}
            disabled={!editor.canApply || editor.hasScanCorruption}
            prompt={
              settings.applyOnDrop
                ? "Release over a valid destination to apply."
                : undefined
            }
          />
        }
      >
        <RadioChoiceGroup<BlockTransferAction>
          name="block-transfer-action"
          legend="Transfer action"
          value={settings.action}
          options={[
            { value: "copy", label: "Copy", hint: "Source to destination" },
            { value: "swap", label: "Swap", hint: "Exchange both regions" },
          ]}
          onChange={(action) => onChangeSettings({ action })}
          layout="inline"
        />
        <label className="effect-auto-apply">
          <input
            type="checkbox"
            checked={settings.applyOnDrop}
            disabled={editor.isEncoding || editor.hasScanCorruption}
            onChange={(event) =>
              onChangeSettings({ applyOnDrop: event.currentTarget.checked })
            }
          />
          Apply on drop
        </label>
      </BlockTransformFrame>
    );
  },
};
