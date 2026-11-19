import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const ZeroSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "zero",
  frequencyBand: "all",
  strength: 0,
  seed: 1,
};

export const ZeroView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "zero",
    label: "Zero Coefficients",
    description: "Clears the tones or detail band you select.",
    iconPaths: [
      "M5 2h4v4H5z",
      "M10 2h4v4h-4z",
      "M15 2h4v4h-4z",
      "M5 7h4v4H5z",
      "M5 12h4v4H5z",
      "M15 7h4v4h-4z",
      "M15 12h4v4h-4z",
      "M5 17h4v4H5z",
      "M10 17h4v4h-4z",
      "M15 17h4v4h-4z",
    ],
    defaultSettings: ZeroSettings,
    historyModes: ["zero"],
    showBandMatrix: true,
    bandLabel: "Clear coefficients",
  });
