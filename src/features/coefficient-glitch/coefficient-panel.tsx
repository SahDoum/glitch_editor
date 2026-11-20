import type { ReactNode } from "react";
import { EffectActions } from "../../ui/effect-actions";
import type { CoefficientRecipeStep } from "../../application/experiment-recipes";
import {
  ComponentChoiceGroup,
  getChannelLabel,
} from "../../ui/component-choice-group";
import { ComponentPreview } from "../../ui/component-preview";
import {
  DctBasisMatrix,
  type DctFrequencyChoice,
} from "../../ui/dct-basis-matrix";
import {
  getCoefficientFrequencyChoices,
  getCoefficientRangeOptions,
  RadioChoiceGroup,
} from "../../ui/tool-controls";
import type { EffectEditor, EffectPanelProps } from "../effects/types";

export type CoefficientPanelProps = EffectPanelProps<CoefficientRecipeStep>;

/** Shared chrome of every coefficient panel; effect fields are children. */
export function CoefficientPanelFrame({
  editor,
  children,
  advanced,
}: {
  readonly editor: EffectEditor<CoefficientRecipeStep>;
  readonly children?: ReactNode;
  readonly advanced?: ReactNode;
}) {
  const { colorModel, inspection, componentIndex } = editor;
  return (
    <section className="inspector-section selection-panel">
      {children}
      {editor.operationError && (
        <p className="field-error" role="status">
          {editor.operationError}
        </p>
      )}
      <p className="channel-readout">
        Channel ·{" "}
        {getChannelLabel(
          inspection.components,
          componentIndex,
          editor.componentLabels,
        )}
      </p>
      <details className="advanced-controls">
        <summary>Advanced settings</summary>
        <div className="advanced-control-content">
          {advanced}
          <ComponentChoiceGroup
            name="coefficient-component"
            inspection={inspection}
            componentLabels={editor.componentLabels}
            value={componentIndex}
            includeUnavailable
            onChange={editor.onChangeComponent}
          />
          {(colorModel?.kind === "ycbcr" ||
            colorModel?.kind === "assumed-ycbcr") && (
            <div className="component-explanations">
              <p>
                <strong>Y</strong> is luminance and represents brightness
                information.
              </p>
              <p>
                <strong>Cb</strong> and <strong>Cr</strong> carry
                blue-difference and red-difference chroma information. Chroma
                may have lower spatial resolution due to JPEG subsampling.
              </p>
            </div>
          )}
          {inspection.components.length === 3 &&
            (colorModel?.kind === "ycbcr" ||
              colorModel?.kind === "assumed-ycbcr" ||
              colorModel?.kind === "rgb") && (
              <ComponentPreview
                imageUrl={editor.imageUrl}
                component={
                  colorModel.kind === "rgb"
                    ? ((["R", "G", "B"] as const)[componentIndex] ?? "R")
                    : ((["Y", "Cb", "Cr"] as const)[componentIndex] ?? "Y")
                }
              />
            )}
          {colorModel && (
            <p className="component-model-note" role="status">
              {colorModel.description}
            </p>
          )}
        </div>
      </details>
      <EffectActions
        prompt={editor.autoApplyPrompt}
        onApply={() => editor.apply()}
        disabled={
          !editor.canApply ||
          !editor.hasMask ||
          editor.hasScanCorruption ||
          componentIndex >= inspection.components.length
        }
      />
    </section>
  );
}

/** DC / AC band picker for effects whose target range the user chooses. */
export function CoefficientBandMatrix({
  settings,
  onChangeSettings,
}: Pick<CoefficientPanelProps, "settings" | "onChangeSettings">) {
  const choices = getCoefficientFrequencyChoices(settings.mode);
  if (choices.length === 0) return null;
  const selectedChoice: DctFrequencyChoice =
    settings.domain === "dc" ? "dc" : settings.frequencyBand;
  return (
    <DctBasisMatrix
      selectedChoice={selectedChoice}
      availableChoices={choices}
      onSelect={(choice) =>
        onChangeSettings(
          choice === "dc"
            ? { domain: "dc", frequencyBand: "all" }
            : { domain: "ac", frequencyBand: choice },
        )
      }
    />
  );
}

export function CoefficientBandPicker({
  settings,
  onChangeSettings,
  legend,
}: Pick<CoefficientPanelProps, "settings" | "onChangeSettings"> & {
  readonly legend: string;
}) {
  const options = getCoefficientRangeOptions(settings.mode).map((option) => ({
    value: option.value,
    label:
      option.value === "dc"
        ? "Tone (DC)"
        : option.value === "ac:all"
          ? "All details"
          : `${option.value.slice(3, 4).toUpperCase()}${option.value.slice(4)} detail frequencies`,
  }));
  return (
    <RadioChoiceGroup
      name="coefficient-detail-band"
      legend={legend}
      value={settings.domain === "dc" ? "dc" : `ac:${settings.frequencyBand}`}
      options={options}
      onChange={(value) =>
        onChangeSettings(
          value === "dc"
            ? { domain: "dc", frequencyBand: "all" }
            : {
                domain: "ac",
                frequencyBand: value.slice(
                  3,
                ) as CoefficientRecipeStep["frequencyBand"],
              },
        )
      }
      layout="bands"
    />
  );
}

export function CoefficientNumberField({
  label,
  min,
  max,
  settings,
  onChangeSettings,
}: Pick<CoefficientPanelProps, "settings" | "onChangeSettings"> & {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}) {
  return (
    <label className="coefficient-field tool-field">
      <span>{label}</span>
      <input
        type="number"
        min={String(min)}
        max={String(max)}
        step="1"
        value={settings.strength}
        onChange={(event) =>
          onChangeSettings({ strength: Number(event.currentTarget.value) })
        }
      />
    </label>
  );
}

export function CoefficientRangeField({
  labelId,
  label,
  min,
  max,
  step,
  lowLabel,
  highLabel,
  note,
  extra,
  advanced = false,
  settings,
  onChangeSettings,
}: Pick<CoefficientPanelProps, "settings" | "onChangeSettings"> & {
  readonly labelId: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly lowLabel: string;
  readonly highLabel: string;
  readonly note?: string;
  readonly extra?: ReactNode;
  readonly advanced?: boolean;
}) {
  const update = (value: string) =>
    onChangeSettings({ strength: Number(value) });
  if (advanced) {
    return (
      <div>
        <label className="coefficient-field tool-field">
          <span>{label.split(" · ")[0]} value</span>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={settings.strength}
            onChange={(event) => update(event.currentTarget.value)}
          />
        </label>
        {note && <p className="coefficient-note">{note}</p>}
      </div>
    );
  }
  return (
    <div className="coefficient-field tool-field range-field">
      {extra}
      <span id={labelId}>{label}</span>
      <div className="range-input-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={settings.strength}
          aria-labelledby={labelId}
          onChange={(event) => update(event.currentTarget.value)}
        />
      </div>
      <div className="range-endpoints">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
