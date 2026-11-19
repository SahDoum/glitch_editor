import type { ReactNode } from "react";
import type { CoefficientRecipeStep } from "../../application/experiment-recipes";
import type { CoefficientGlitchMode } from "../../operations/jpeg-glitch";
import { MASK_EFFECT_TOOLBAR } from "../effects/mask-tools";
import type { EffectId, EffectView } from "../effects/types";
import {
  CoefficientBandMatrix,
  CoefficientBandPicker,
  CoefficientPanelFrame,
  type CoefficientPanelProps,
} from "./coefficient-panel";
import { createCoefficientOperationDescriptor } from "./coefficient-operation";
import { coefficientSettingsStore } from "./coefficient-settings-store";

export interface CoefficientViewDefinition {
  readonly id: EffectId;
  readonly label: string;
  readonly description: string;
  readonly iconPaths: readonly string[];
  readonly defaultSettings: CoefficientRecipeStep;
  /** Recorded modes this view's history entries may carry. */
  readonly storageKey?: string;
  readonly historyModes: readonly CoefficientGlitchMode[];
  /** Fixed presets have no persisted or editable settings. */
  readonly editable?: boolean;
  readonly showBandMatrix?: boolean;
  readonly bandLabel?: string;
  readonly Fields?: (
    props: CoefficientPanelProps & { readonly advanced?: boolean },
  ) => ReactNode;
}

export function defineCoefficientView(
  definition: CoefficientViewDefinition,
): EffectView<CoefficientRecipeStep> {
  const { Fields, showBandMatrix = false, editable = true } = definition;
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    category: "Coefficients",
    iconPaths: definition.iconPaths,
    interaction: "mask",
    toolbar: MASK_EFFECT_TOOLBAR,
    autoApply: true,
    autoPreview: true,
    defaultSettings: definition.defaultSettings,
    storageKey: definition.storageKey,
    settingsStore: editable ? coefficientSettingsStore : undefined,
    operation: createCoefficientOperationDescriptor(definition.historyModes),
    Panel(props) {
      return (
        <CoefficientPanelFrame
          editor={props.editor}
          advanced={
            <>
              {showBandMatrix && <CoefficientBandMatrix {...props} />}
              {Fields && <Fields {...props} advanced />}
            </>
          }
        >
          {definition.bandLabel && (
            <CoefficientBandPicker {...props} legend={definition.bandLabel} />
          )}
          {Fields && <Fields {...props} />}
        </CoefficientPanelFrame>
      );
    },
  };
}
