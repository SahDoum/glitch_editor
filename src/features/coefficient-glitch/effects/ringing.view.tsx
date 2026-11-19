import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientRangeField } from "../coefficient-panel";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const RingingSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "ringing-boost",
  frequencyBand: "all",
  strength: 4,
  seed: 1,
};

export const RingingView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "ringing",
    label: "Ringing Halo",
    description: "May add halos around high-contrast edges.",
    iconPaths: [
      "M12 3a9 9 0 1 0 9 9",
      "M8 1q2-1 4-1",
      "M10 22q2 1 4 1",
      "M3 14q-1-1-1 2",
      "M4.5 7q1.5-1 3-1.5",
      "M16 3l1 1",
      "M2 18l1 1",
      "M18 20.5l-1-1.5",
      "M6 3.5l1 1",
    ],
    defaultSettings: RingingSettings,
    historyModes: ["ringing-boost"],
    Fields: (props) => (
      <CoefficientRangeField
        {...props}
        labelId="ringing-boost-label"
        label={`Halo strength · ${props.settings.strength}×`}
        min={1}
        max={8}
        step={0.1}
        lowLabel="1× · low-pass only"
        highLabel="8× · stronger"
        note="Keeps DC and AC with u+v below 3, boosts AC at 3, and removes higher AC in masked blocks. May create edge halos, blur or block artifacts."
      />
    ),
  });
