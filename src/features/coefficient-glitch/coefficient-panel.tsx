import type { ReactNode } from "react";
import type { CoefficientRecipeStep } from "../../application/experiment-recipes";
import { ComponentChoiceGroup } from "../../ui/component-choice-group";
import { ComponentPreview } from "../../ui/component-preview";
import {
  DctBasisMatrix,
  type DctFrequencyChoice,
} from "../../ui/dct-basis-matrix";
import { getCoefficientRangeOptions } from "../../ui/tool-controls";
import type { EffectEditor, EffectPanelProps } from "../effects/types";

export type CoefficientPanelProps = EffectPanelProps<CoefficientRecipeStep>;

/** Shared chrome of every coefficient panel; effect fields are children. */
export function CoefficientPanelFrame({
  editor,
  children,
}: {
  readonly editor: EffectEditor<CoefficientRecipeStep>;
  readonly children?: ReactNode;
}) {
  const { colorModel, inspection, componentIndex } = editor;
  return (
    <section className="inspector-section selection-panel">
      {!editor.hasMask && (
        <p className="selection-required" role="status">
          Select an area to apply this effect. Brush and Select are available in
          the canvas toolbar.
        </p>
      )}
      <div className="coefficient-effect-actions">
        <button
          className="operation-button"
          type="button"
          disabled={
            !editor.hasMask ||
            editor.isEncoding ||
            editor.hasScanCorruption ||
            componentIndex >= inspection.components.length
          }
          onClick={() => editor.apply()}
        >
          Apply
        </button>
        <label className="effect-auto-apply">
          <input
            type="checkbox"
            checked={editor.autoApply}
            disabled={editor.autoApplyDisabled}
            onChange={(event) =>
              editor.onChangeAutoApply(event.currentTarget.checked)
            }
          />
          Apply while painting
        </label>
      </div>
      <h3 className="parameter-group-title">Core parameters</h3>
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
            <strong>Cb</strong> and <strong>Cr</strong> carry blue-difference
            and red-difference chroma information. Chroma may have lower spatial
            resolution due to JPEG subsampling.
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
      {children}
    </section>
  );
}

/** DC / AC band picker for effects whose target range the user chooses. */
export function CoefficientBandMatrix({
  settings,
  onChangeSettings,
}: Pick<CoefficientPanelProps, "settings" | "onChangeSettings">) {
  const choices: readonly DctFrequencyChoice[] = getCoefficientRangeOptions(
    settings.mode,
  ).map(({ value }) =>
    value === "dc" ? "dc" : (value.slice(3) as DctFrequencyChoice),
  );
  if (choices.length === 0) return null;
  const selectedChoice: DctFrequencyChoice =
    settings.domain === "dc" ? "dc" : settings.frequencyBand;
  return (
    <DctBasisMatrix
      target={
        settings.domain === "dc"
          ? { kind: "dc" }
          : { kind: "band", band: settings.frequencyBand }
      }
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
}) {
  const update = (value: string) =>
    onChangeSettings({ strength: Number(value) });
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
        <input
          type="number"
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
      {note && <p className="coefficient-note">{note}</p>}
    </div>
  );
}
