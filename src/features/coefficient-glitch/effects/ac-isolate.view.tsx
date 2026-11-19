import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const AcIsolateSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "isolate",
  frequencyBand: "low",
  strength: 0,
  seed: 1,
};

export const AcIsolateView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "ac-isolate",
    label: "Isolate Detail Band",
    description: "Highlights one scale of detail.",
    iconPaths: ["M3 12h4", "M9 12h6", "M17 12h4", "M9 7v10", "M15 7v10"],
    defaultSettings: AcIsolateSettings,
    historyModes: ["isolate"],
    showBandMatrix: true,
    bandLabel: "Detail scale",
    Fields: ({ advanced }) =>
      advanced && (
        <p className="coefficient-note">
          Isolate band targets AC only. DC is not an AC band, and selecting AC
          All would leave no coefficients outside the selected range to clear.
        </p>
      ),
  });
