import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientNumberField } from "../coefficient-panel";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const DcOffsetSettings: CoefficientRecipeStep = {
  domain: "dc",
  mode: "offset",
  frequencyBand: "all",
  strength: 32,
  seed: 1,
};

export const DcOffsetView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "dc-offset",
    label: "DC Offset",
    description: "Add an offset to selected blocks' quantized DC coefficients.",
    iconPaths: ["M4 12h6", "M14 12h6", "M12 5v14", "M9 8l3-3 3 3"],
    defaultSettings: DcOffsetSettings,
    historyModes: ["offset"],
    Fields: (props) => (
      <CoefficientNumberField
        {...props}
        label="DC offset"
        min={-2047}
        max={2047}
      />
    ),
  });
