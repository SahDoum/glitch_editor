import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientRangeField } from "../coefficient-panel";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const EngravingVerticalSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "engrave-vertical",
  frequencyBand: "all",
  strength: 4,
  seed: 1,
};

export const EngravingVerticalView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "engraving-vertical",
    label: "Engraving · Vertical",
    description: "Keep DC and vertical-axis AC; remove other AC.",
    iconPaths: [
      "M9 1h6v4H9z",
      "M8 3h8v2H8z",
      "M9 6l3 3 3-3",
      "M12 8v10",
      "M3 23h6l3 2 3-2h6",
      "M5 12l3 5",
      "M19 12l-3 5",
      "M3 18l4 2",
      "M22 18l-5 1",
    ],
    defaultSettings: EngravingVerticalSettings,
    historyModes: ["engrave-vertical"],
    Fields: (props) => (
      <CoefficientRangeField
        {...props}
        labelId="engraving-strength-label"
        label={`Directional AC gain · ${props.settings.strength}×`}
        min={1}
        max={8}
        step={0.1}
        lowLabel="1× · directional cut"
        highLabel="8× · stronger"
        note="Keeps DC and scales AC on one frequency axis; other AC is removed in masked blocks. The result may be blocky and is not guaranteed to resemble engraving."
      />
    ),
  });
