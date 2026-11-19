import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientRangeField } from "../coefficient-panel";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const PosterizationSettings: CoefficientRecipeStep = {
  domain: "dc",
  mode: "dc-steps",
  frequencyBand: "all",
  strength: 32,
  seed: 1,
};

export const PosterizationView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "posterization",
    label: "Posterization",
    description: "Groups tones into visible steps.",
    iconPaths: [
      "M4 3h16v13l-4 4H4z",
      "M16 16h4l-4 4z",
      "M10 6h4v4h-4z",
      "M8 14v-1.5l2-1.5h4l2 1.5V14z",
    ],
    defaultSettings: PosterizationSettings,
    storageKey: "dc-steps",
    historyModes: ["dc-steps"],
    Fields: (props) => (
      <CoefficientRangeField
        {...props}
        labelId="dc-step-label"
        label={`Step size · ${props.settings.strength}`}
        min={1}
        max={512}
        step={1}
        lowLabel="1 · finest"
        highLabel="512 · coarser"
        note="Rounds the selected component's quantized DC coefficients; AC remains unchanged. This may produce blocky tonal steps, not guaranteed pixel posterization."
      />
    ),
  });
