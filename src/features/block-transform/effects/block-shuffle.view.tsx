import { SeedField } from "../../../ui/tool-controls";
import { MASK_EFFECT_TOOLBAR } from "../../effects/mask-tools";
import { field } from "../../effects/operation-fields";
import type { EffectView } from "../../effects/types";
import { BlockTransformFrame } from "../block-transform.shared";

export interface BlockShuffleSettings {
  readonly seed: number;
}

export const BlockShuffleView: EffectView<BlockShuffleSettings> = {
  id: "block-shuffle",
  label: "Block Shuffle",
  description: "Shuffle whole DCT blocks inside the selected mask.",
  category: "Blocks",
  iconPaths: [
    "M4 5h5v5H4z",
    "M15 5h5v5h-5z",
    "M4 15h5v5H4z",
    "M15 15h5v5h-5z",
    "m9 8 6 8",
    "m15 8-6 8",
  ],
  interaction: "mask",
  toolbar: MASK_EFFECT_TOOLBAR,
  autoApply: true,
  autoPreview: false,
  defaultSettings: { seed: 1 },
  operation: {
    kinds: ["block-permutation"],
    title: "Block shuffle",
    describe: (parameters) => (
      <>
        Component {field(parameters, "componentIndex")} · seed{" "}
        {field(parameters, "seed")} · Fisher–Yates
      </>
    ),
  },
  Panel({ settings, editor, onChangeSettings }) {
    return (
      <BlockTransformFrame editor={editor} requiresMask>
        <p className="operation-description">
          Seeded Fisher–Yates permutation of whole blocks within the selected
          mask. Every selected block is used once; blocks outside it are
          unchanged.
        </p>
        <SeedField
          label="Deterministic seed"
          value={settings.seed}
          onChange={(value) => onChangeSettings({ seed: Number(value) })}
        />
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
          Shuffle blocks in mask
        </button>
      </BlockTransformFrame>
    );
  },
};
