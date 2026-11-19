import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const AcInvertSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "invert",
  frequencyBand: "all",
  strength: 0,
  seed: 1,
};

export const AcInvertView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "ac-invert",
    label: "Invert Details",
    description: "Reverses contrast in a selected detail band.",
    iconPaths: ["M4 7h6l4 10h6", "m17 14 3 3-3 3", "m7 4-3 3 3 3"],
    defaultSettings: AcInvertSettings,
    historyModes: ["invert"],
    showBandMatrix: true,
    bandLabel: "Detail band",
    Fields: ({ advanced, editor }) =>
      advanced ? (
        <p className="coefficient-note">
          Negates the AC coefficients in the selected u+v range.
        </p>
      ) : editor.imageUrl ? (
        <figure className="detail-band-example">
          <img
            src={editor.imageUrl}
            alt="Current photo with the selected detail settings"
          />
        </figure>
      ) : null,
  });
