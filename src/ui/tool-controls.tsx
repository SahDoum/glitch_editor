import type { JpegComponent, JpegInspection } from "../jpeg/inspect";
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
  if (mode === "offset") return [];

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
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange(value: T): void;
  layout?: "grid" | "inline" | "triple" | "components" | "bands";
  disabled?: boolean;
}) {
  return (
    <fieldset
      className={`radio-choice-group radio-choice-group--${layout}`}
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

export function getComponentChoiceOptions(
  components: readonly JpegComponent[],
): ChoiceOption<number>[] {
  const componentIds = components.map(({ id }) => id).join(",");
  const hasCommonYcbcrOrder =
    components.length === 3 &&
    (componentIds === "0,1,2" || componentIds === "1,2,3");
  const roles = [
    {
      label: "Y — Brightness / contours",
    },
    {
      label: "Cb — Blue–yellow color information",
      tone: "blue-yellow" as const,
    },
    {
      label: "Cr — Red–green color information",
      tone: "red-green" as const,
    },
  ];

  return components.map((component, index) => {
    const role =
      components.length === 1
        ? {
            label: "Gray",
            hint: `Single JPEG component · ID ${component.id} · ${component.horizontalSampling}×${component.verticalSampling}`,
          }
        : hasCommonYcbcrOrder
          ? {
              ...roles[index]!,
              hint: `ID ${component.id} · ${component.horizontalSampling}×${component.verticalSampling}`,
            }
          : {
              label: `Component ${index + 1}`,
              hint: `JPEG component · ID ${component.id} · ${component.horizontalSampling}×${component.verticalSampling}`,
            };

    return {
      value: index,
      label: role.label,
      hint: role.hint,
      tone: "tone" in role ? role.tone : undefined,
    };
  });
}

export function ComponentChoiceGroup({
  name,
  inspection,
  value,
  onChange,
  includeUnavailable = false,
}: {
  name: string;
  inspection: JpegInspection;
  value: number;
  onChange(value: number): void;
  includeUnavailable?: boolean;
}) {
  const options = getComponentChoiceOptions(inspection.components);

  if (includeUnavailable && !inspection.components[value]) {
    options.push({
      value,
      label: `Component ${value}`,
      hint: "Unavailable in this JPEG",
      disabled: true,
    });
  }

  return (
    <>
      <RadioChoiceGroup
        name={name}
        legend="Color component"
        value={value}
        options={options}
        onChange={onChange}
        layout="components"
      />
      <p className="coefficient-note component-choice-note">
        Y/Cb/Cr labels follow the common frame order for sequential component
        IDs 0–2 or 1–3. Other arrangements stay neutral; IDs and sampling
        factors are the JPEG frame metadata.
      </p>
    </>
  );
}

export function SeedField({
  id,
  label,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: number | string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  return (
    <div className="coefficient-field seed-field">
      <label htmlFor={id}>{label}</label>
      <div className="seed-input-row">
        <input
          id={id}
          type="number"
          min="0"
          max="4294967295"
          step="1"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <button
          className="operation-button secondary seed-randomize"
          type="button"
          aria-label={`Randomize ${label.toLowerCase()}`}
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
          Randomize
        </button>
      </div>
    </div>
  );
}
