import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const PixelateSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "zero",
  frequencyBand: "all",
  strength: 0,
  seed: 1,
};

export const PixelateView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "pixelate",
    label: "Pixelate",
    description: "Turns detail into visible blocks.",
    iconPaths: [
      "M3 3h8v8H3z",
      "M13 3h8v8h-8z",
      "M3 13h8v8H3z",
      "M13 13h8v8h-8z",
    ],
    defaultSettings: PixelateSettings,
    historyModes: ["zero"],
    editable: false,
  });
