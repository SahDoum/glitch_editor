import { EffectActions } from "../../../ui/effect-actions";
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
  label: "Shuffle Blocks",
  description: "Rearranges whole blocks inside the area.",
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
        {field(parameters, "seed")}
      </>
    ),
  },
  Panel({ settings, editor, onChangeSettings }) {
    return (
      <BlockTransformFrame
        editor={editor}
        advanced={
          <SeedField
            label="Seed"
            value={settings.seed}
            onChange={(value) => onChangeSettings({ seed: Number(value) })}
            showNewVariation={false}
          />
        }
        actions={
          <EffectActions
            prompt={editor.autoApplyPrompt}
            onApply={() => editor.apply()}
            onPreview={() => editor.preview()}
            disabled={
              !editor.canApply || !editor.hasMask || editor.hasScanCorruption
            }
            isPreviewing={editor.isPreviewing}
          />
        }
      >
        <SeedField
          label="Seed"
          showValue={false}
          value={settings.seed}
          onChange={(value) => onChangeSettings({ seed: Number(value) })}
        />
      </BlockTransformFrame>
    );
  },
};
