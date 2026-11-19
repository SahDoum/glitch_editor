import type { CoefficientRecipeStep } from "../../../application/experiment-recipes";
import { CoefficientRangeField } from "../coefficient-panel";
import { defineCoefficientView } from "../coefficient-view";
import type { EffectView } from "../../effects/types";

export const AcLowPassSettings: CoefficientRecipeStep = {
  domain: "ac",
  mode: "low-pass",
  frequencyBand: "all",
  strength: 4,
  seed: 1,
};

export const AcLowPassView: EffectView<CoefficientRecipeStep> =
  defineCoefficientView({
    id: "ac-low-pass",
    label: "Smooth Details",
    description: "Softens fine detail within JPEG blocks.",
    iconPaths: ["M3 17h4l3-7 3 4 3-9 5 2", "M3 21h18"],
    defaultSettings: AcLowPassSettings,
    historyModes: ["low-pass"],
    Fields: (props) => (
      <CoefficientRangeField
        {...props}
        labelId="ac-cutoff-label"
        label={`Detail retention · ${props.settings.strength}`}
        min={1}
        max={14}
        step={1}
        lowLabel="1 · strongest cutoff"
        highLabel="14 · unchanged"
        note="Keeps DC and AC with u+v at or below the cutoff; removes higher AC in masked blocks. Edge halos are possible but not guaranteed."
      />
    ),
  });
