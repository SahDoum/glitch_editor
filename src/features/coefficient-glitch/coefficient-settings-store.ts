import type { CoefficientRecipeStep } from "../../application/experiment-recipes";
import {
  readCoefficientEffectSettings,
  writeCoefficientEffectSettings,
} from "../../application/coefficient-effect-settings";
import type { EffectSettingsStore } from "../effects/types";
import { normalizeCoefficientStep } from "./coefficient-effect-controller";

/** Existing localStorage format: one record of steps keyed by effect id. */
export const coefficientSettingsStore: EffectSettingsStore<CoefficientRecipeStep> =
  {
    read: readCoefficientEffectSettings,
    write(storage, entries) {
      return writeCoefficientEffectSettings(
        storage,
        Object.fromEntries(
          Object.entries(entries).map(([id, step]) => [
            id,
            normalizeCoefficientStep(step),
          ]),
        ),
      );
    },
  };
