import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientNumberField } from "../coefficient-panel";
import { SeedField } from "../../../ui/tool-controls";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const CoefficientRandomizeSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "randomize",
  frequencyBand: "all",
  strength: 32,
  seed: 1,
};

export const CoefficientRandomizeView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "coefficient-randomize",
    label: "Random Texture",
    description: "Adds repeatable random texture to the area.",
    iconPaths: [
      "M4 6h4l3 6 3-6h6",
      "M4 18h4l3-6 3 6h6",
      "m17 3 3 3-3 3",
      "m17 15 3 3-3 3",
    ],
    defaultSettings: CoefficientRandomizeSettings,
    historyModes: ["randomize"],
    showBandMatrix: true,
    Fields: (props) => (
      <>
        {!props.advanced && (
          <CoefficientNumberField
            {...props}
            label="Variation range"
            min={1}
            max={2047}
          />
        )}
        <SeedField
          showValue={Boolean(props.advanced)}
          showNewVariation={!props.advanced}
          label="Seed"
          value={props.settings.seed}
          onChange={(value) => props.onChangeSettings({ seed: Number(value) })}
        />
      </>
    ),
  });
