import { useEffect, useMemo, useRef, useState } from "react";
import { getQuantizationTableLabel } from "../../jpeg/color-model";
import type { JpegInspection } from "../../jpeg/inspect";
import {
  createQuantizationPattern,
  QUANTIZATION_PATTERNS,
  type JpegGlitchOperation,
  type QuantizationPattern,
  type QuantizationSemantics,
} from "../../operations/jpeg-glitch";
import { RadioChoiceGroup, SeedField } from "../../ui/tool-controls";
import { WHOLE_IMAGE_TOOLBAR } from "../effects/mask-tools";
import { field } from "../effects/operation-fields";
import type {
  EffectEditor,
  EffectPanelProps,
  EffectView,
} from "../effects/types";

export interface QuantizationSettings {
  readonly tableId: number;
  readonly values: readonly number[];
  readonly semantics: QuantizationSemantics;
  readonly pattern: QuantizationPattern | "manual";
  readonly seed: number;
}

/** DQT tables as last edited by the active operations, per table id. */
export function getCurrentQuantizationTables(
  inspection: JpegInspection,
  operations: readonly JpegGlitchOperation[],
) {
  const latest = new Map<number, readonly number[]>();
  for (const operation of operations) {
    if (operation.kind === "quantization") {
      latest.set(operation.tableId, operation.values);
    }
  }
  return inspection.quantizationTables.map((table) => ({
    id: table.id,
    values: [...(latest.get(table.id) ?? table.values)],
  }));
}

export const QuantizationView: EffectView<QuantizationSettings> = {
  id: "quantization",
  label: "Quantization Table",
  description:
    "Changes the JPEG values that control tone and detail precision.",
  category: "Quantization",
  iconPaths: [
    "M4 4h16v16H4z",
    "M9.3 4v16",
    "M14.7 4v16",
    "M4 9.3h16",
    "M4 14.7h16",
  ],
  interaction: "panel",
  toolbar: WHOLE_IMAGE_TOOLBAR,
  autoApply: false,
  autoPreview: false,
  defaultSettings: {
    tableId: 0,
    values: [],
    semantics: "reinterpret",
    pattern: "manual",
    seed: 1,
  },
  operation: {
    kinds: ["quantization"],
    title: "DQT matrix edit",
    describe: (parameters) => (
      <>
        DQT {field(parameters, "tableId")} · {field(parameters, "semantics")} ·{" "}
        {field(parameters, "pattern")} · seed {field(parameters, "seed")}
      </>
    ),
  },
  Panel: QuantizationPanel,
};

function QuantizationPanel({ editor }: EffectPanelProps<QuantizationSettings>) {
  return <QuantizationMatrixView key={editor.assetKey} editor={editor} />;
}

function QuantizationMatrixView({
  editor,
}: {
  readonly editor: EffectEditor<QuantizationSettings>;
}) {
  const quantizationTables = useMemo(
    () => getCurrentQuantizationTables(editor.inspection, editor.operations),
    [editor.inspection, editor.operations],
  );
  const { componentLabels, onError } = editor;
  const components = editor.inspection.components;
  const disabled = editor.isEncoding || editor.hasScanCorruption;
  const onDraftChange = editor.discardPreview;
  const [tableId, setTableId] = useState(quantizationTables[0]?.id ?? 0);
  const [values, setValues] = useState<number[]>(
    () => quantizationTables[0]?.values.slice() ?? [],
  );
  const [pattern, setPattern] = useState<QuantizationPattern | "manual">(
    "manual",
  );
  const [semantics, setSemantics] =
    useState<QuantizationSemantics>("reinterpret");
  const [seed, setSeed] = useState("1");
  const onPreviewRef = useRef(editor.preview);
  useEffect(() => {
    onPreviewRef.current = editor.preview;
  }, [editor.preview]);
  const settingsOf = (): QuantizationSettings => ({
    tableId,
    values,
    semantics,
    pattern,
    seed: Number(seed),
  });
  const table = quantizationTables.find(
    (candidate) => candidate.id === tableId,
  );

  function chooseTable(value: string) {
    const nextId = Number(value);
    const nextTable = quantizationTables.find(
      (candidate) => candidate.id === nextId,
    );
    if (!nextTable) return;
    setTableId(nextId);
    setValues(nextTable.values.slice());
    onDraftChange();
    onError("");
  }

  function choosePattern(next: QuantizationPattern | "manual") {
    setPattern(next);
    onError("");
    if (next === "manual") {
      onDraftChange();
      return;
    }
    const seedValue = Number(seed);
    const result = createQuantizationPattern(next, values, seedValue);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setValues([...result.value]);
    onDraftChange();
  }

  function changeSeed(value: string) {
    setSeed(value);
    const seedValue = Number(value);
    if (
      pattern !== "random" ||
      !Number.isInteger(seedValue) ||
      seedValue < 0 ||
      seedValue > 0xffff_ffff
    ) {
      onDraftChange();
      return;
    }
    const result = createQuantizationPattern("random", values, seedValue);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setValues([...result.value]);
    onDraftChange();
  }

  const validValues =
    values.length === 64 &&
    Number.isInteger(Number(seed)) &&
    Number(seed) >= 0 &&
    Number(seed) <= 0xffff_ffff &&
    values.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 255,
    );

  useEffect(() => {
    if (!validValues || !table) return;
    const timeout = window.setTimeout(() => {
      onPreviewRef.current({
        tableId,
        values,
        semantics,
        pattern,
        seed: Number(seed),
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [pattern, seed, semantics, table, tableId, validValues, values]);

  return (
    <section className="inspector-section quantization-editor">
      <RadioChoiceGroup<number>
        name="quantization-table"
        legend="Table assigned to component(s)"
        value={tableId}
        options={quantizationTables.map((entry) => ({
          value: entry.id,
          label: getQuantizationTableLabel(
            entry.id,
            components,
            componentLabels,
          ),
        }))}
        disabled={disabled}
        onChange={(id) => chooseTable(String(id))}
        layout="inline"
      />
      <h3 className="parameter-group-title">Core parameters</h3>
      <RadioChoiceGroup<QuantizationPattern | "manual">
        name="quantization-pattern"
        legend="Quantization pattern"
        value={pattern}
        options={[
          { value: "manual", label: "Manual" },
          ...QUANTIZATION_PATTERNS.map((candidate) => ({
            value: candidate,
            label: candidate.replaceAll("-", " "),
          })),
        ]}
        disabled={disabled}
        onChange={choosePattern}
      />
      <div className="coefficient-table-wrap">
        <table className="coefficient-table editable-quantization-table">
          <tbody>
            {Array.from({ length: 8 }, (_, v) => (
              <tr key={v}>
                {Array.from({ length: 8 }, (_, u) => {
                  const index = v * 8 + u;
                  return (
                    <td
                      className={u === 0 && v === 0 ? "coefficient-dc" : ""}
                      key={u}
                    >
                      <input
                        aria-label={`DQT ${tableId}, u ${u}, v ${v}`}
                        type="number"
                        min="1"
                        max="255"
                        step="1"
                        value={values[index] ?? ""}
                        disabled={disabled}
                        onChange={(event) => {
                          const next = values.slice();
                          next[index] = Number(event.currentTarget.value);
                          setValues(next);
                          setPattern("manual");
                          onDraftChange();
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pattern === "random" && (
        <SeedField
          label="Random pattern seed"
          value={seed}
          disabled={disabled}
          onChange={changeSeed}
        />
      )}
      <details className="advanced-controls">
        <summary>Advanced parameters · quantization semantics</summary>
        <div className="advanced-control-content">
          <RadioChoiceGroup<QuantizationSemantics>
            name="quantization-semantics"
            legend="Apply semantics"
            value={semantics}
            options={[
              {
                value: "reinterpret",
                label: "Reinterpret",
                hint: "Keep quantized coefficients",
              },
              {
                value: "requantize",
                label: "Requantize",
                hint: "Estimate from retained coefficients",
              },
            ]}
            disabled={disabled}
            onChange={(value) => {
              setSemantics(value);
              onDraftChange();
            }}
            layout="inline"
          />
          <p className="coefficient-note">
            {semantics === "reinterpret"
              ? "Keeps quantized coefficients and changes their DQT interpretation."
              : "Approximates unquantized values as old coefficient × old DQT, then divides by the new DQT. Discarded information is not restored."}
          </p>
        </div>
      </details>
      <div className="operation-actions">
        <button
          className="operation-button"
          type="button"
          disabled={disabled || !table || !validValues}
          onClick={() => editor.apply(settingsOf())}
        >
          Apply
        </button>
      </div>
    </section>
  );
}
