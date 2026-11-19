import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientRangeField } from "../coefficient-panel";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const AcScaleSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "scale",
  frequencyBand: "all",
  strength: 2,
  seed: 1,
};

export const AcScaleView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "ac-scale",
    label: "Coefficient Scale",
    description: "Scales the selected JPEG coefficients.",
    iconPaths: ["M4 18h16", "M6 15V9", "M10 15V5", "M14 15V8", "M18 15V3"],
    defaultSettings: AcScaleSettings,
    storageKey: "chroma-scale",
    historyModes: ["scale"],
    showBandMatrix: true,
    Fields: (props) => (
      <CoefficientRangeField
        {...props}
        labelId="coefficient-strength-label"
        label={`Multiplier · ${props.settings.strength}×`}
        min={-8}
        max={8}
        step={0.1}
        lowLabel="−8 · reduce or invert"
        highLabel="+8 · increase"
        note="Negative values reverse the sign of the selected coefficients."
      />
    ),
  });
