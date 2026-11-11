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
  label: "Block Transfer",
  description: "Copy or swap a dragged region of DCT blocks.",
  category: "Blocks",
  iconPaths: ["M14 6v-2H2v16h12v-2", "M9 10h8V7l6 5-6 5v-3H9z"],
  interaction: "gesture",
  toolbar: WHOLE_IMAGE_TOOLBAR,
  autoApply: false,
  autoPreview: false,
  defaultSettings: {
    mode: "all",
    action: "copy",
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
      label: "New source",
      title: "Choose a new source region (R)",
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
      <BlockTransformFrame editor={editor} requiresMask={false}>
        <p className="coefficient-note">
          {settings.source
            ? "Source selected. Drag on the image to choose a same-size destination; drop applies one undoable transfer."
            : "Drag on the image to select a rectangular source region snapped to this component's visible 8×8 DCT-block grid."}
        </p>
        {settings.source && (
          <p className="selection-readout">
            Source blocks ({settings.source.x}, {settings.source.y}) ·{" "}
            {settings.source.width} × {settings.source.height}
          </p>
        )}
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
        {settings.action === "swap" && (
          <p className="coefficient-note">
            Swaps must use non-overlapping regions. Use copy for overlapping
            source and destination areas.
          </p>
        )}
      </BlockTransformFrame>
    );
  },
};
