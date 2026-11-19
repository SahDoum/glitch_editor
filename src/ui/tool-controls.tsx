import { useState } from "react";
import { DCT_FREQUENCY_BAND_RANGES } from "../operations/dct";
import {
  GLITCH_FREQUENCY_BANDS,
  type CoefficientGlitchMode,
  type GlitchFrequencyBand,
} from "../operations/jpeg-glitch";
import { createRandomSeed } from "../shared/random";

type ChoiceValue = string | number;

export type ChoiceOption<T extends ChoiceValue> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
  tone?: "blue-yellow" | "red-green";
};

export type CoefficientRangeChoice = "dc" | `ac:${GlitchFrequencyBand}`;

export function getCoefficientRangeOptions(
  mode: CoefficientGlitchMode,
): ChoiceOption<CoefficientRangeChoice>[] {
  if (
    mode === "offset" ||
    mode === "dc-steps" ||
    mode === "low-pass" ||
    mode === "ringing-boost" ||
    mode === "engrave-horizontal" ||
    mode === "engrave-vertical"
  )
    return [];

  return [
    ...(mode !== "invert" && mode !== "isolate"
      ? [
          {
            value: "dc" as const,
            label: "DC",
            hint: "Block-average coefficient",
          },
        ]
      : []),
    ...GLITCH_FREQUENCY_BANDS.filter(
      (band) => mode !== "isolate" || band !== "all",
    ).map((band) => {
      const range = DCT_FREQUENCY_BAND_RANGES[band];
      return {
        value: `ac:${band}` as const,
        label:
          band === "all"
            ? "AC All"
            : `AC ${band[0]?.toUpperCase()}${band.slice(1)}`,
        hint: `u+v ${range.minimum}–${range.maximum}`,
      };
    }),
  ];
}

export function RadioChoiceGroup<T extends ChoiceValue>({
  name,
  legend,
  value,
  options,
  onChange,
  layout = "grid",
  disabled = false,
  showCheckmark = true,
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange(value: T): void;
  layout?: "grid" | "inline" | "triple" | "components" | "bands";
  disabled?: boolean;
  showCheckmark?: boolean;
}) {
  return (
    <fieldset
      className={`radio-choice-group radio-choice-group--${layout} ${showCheckmark ? "" : "radio-choice-group--no-checkmark"}`}
      disabled={disabled}
    >
      <legend>{legend}</legend>
      <div className="radio-choice-options">
        {options.map((option) => (
          <label
            className={`radio-choice-option ${value === option.value ? "is-selected" : ""}`}
            key={String(option.value)}
            data-disabled={option.disabled || undefined}
            data-tone={option.tone}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="radio-choice-copy">
              <span className="radio-choice-label">{option.label}</span>
              {option.hint && (
                <span className="radio-choice-hint">{option.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function EngravingDirectionChoice({
  value,
  onChange,
}: {
  value: "engrave-horizontal" | "engrave-vertical";
  onChange(value: "engrave-horizontal" | "engrave-vertical"): void;
}) {
  return (
    <RadioChoiceGroup
      name="engraving-direction"
      legend="Direction"
      value={value}
      options={[
        {
          value: "engrave-horizontal",
          label: "Horizontal",
        },
        {
          value: "engrave-vertical",
          label: "Vertical",
        },
      ]}
      onChange={onChange}
    />
  );
}

export function SeedField({
  label,
  value,
  onChange,
  disabled = false,
  showValue = true,
  showNewVariation = true,
}: {
  label: string;
  value: number | string;
  onChange(value: string): void;
  disabled?: boolean;
  showValue?: boolean;
  showNewVariation?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState("");

  async function copySeed() {
    if (!navigator.clipboard) {
      setCopyStatus("Clipboard access is unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(String(value));
      setCopyStatus("Seed copied.");
    } catch {
      setCopyStatus("The seed could not be copied.");
    }
  }

  return (
    <div className="coefficient-field seed-field">
      {showValue && <span className="seed-label">{label}</span>}
      <div className="seed-value-row">
        {showValue && (
          <>
            <output className="seed-value" aria-live="polite">
              {value}
            </output>
            <button
              className="seed-copy"
              type="button"
              aria-label={`Copy ${label.toLowerCase()}`}
              title="Copy seed"
              disabled={disabled}
              onClick={() => void copySeed()}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden="true"
              >
                <rect x="5" y="5" width="8" height="9" rx="1" />
                <path d="M10 5V3.5A1.5 1.5 0 0 0 8.5 2h-5A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5" />
              </svg>
            </button>
          </>
        )}
        {showNewVariation && (
          <button
            className="operation-button secondary seed-randomize"
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange(
                String(
                  createRandomSeed(
                    Number.isInteger(Number(value)) ? Number(value) : undefined,
                  ),
                ),
              )
            }
          >
            New variation
          </button>
        )}
      </div>
      {copyStatus && (
        <span className="seed-copy-status" role="status">
          {copyStatus}
        </span>
      )}
    </div>
  );
}
