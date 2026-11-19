import type { ScanCorruptionMode } from "../../jpeg/scan-corruption";
import {
  MAX_SCAN_CORRUPTION_BYTES,
  MAX_SCAN_CORRUPTION_STAGES,
} from "../../jpeg/scan-corruption";
import {
  getScanDecodeDiagnosticMessage,
  getScanDecodeWarningLabels,
} from "../../jpeg/scan-decode-diagnostic";
import { RadioChoiceGroup, SeedField } from "../../ui/tool-controls";
import { WHOLE_IMAGE_TOOLBAR } from "../effects/mask-tools";
import type { EffectPanelProps, EffectView } from "../effects/types";

export interface ScanCorruptSettings {
  readonly mode: ScanCorruptionMode;
  readonly count: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly seed: number;
}

export const ScanCorruptView: EffectView<ScanCorruptSettings> = {
  id: "scan-corrupt",
  label: "JPEG Damage",
  description: "Changes bytes in the encoded JPEG scan.",
  category: "Encoded data",
  iconPaths: ["M6 4h12v8h3v8H9v-8H6z"],
  interaction: "panel",
  toolbar: WHOLE_IMAGE_TOOLBAR,
  autoApply: false,
  autoPreview: false,
  defaultSettings: {
    mode: "bit-flip",
    count: 4,
    rangeStart: 0,
    rangeEnd: 1,
    seed: 1,
  },
  Panel: ScanCorruptPanel,
};

function formatOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(6, "0").toUpperCase()}`;
}

function ScanCorruptPanel({
  settings,
  editor,
  onChangeSettings,
}: EffectPanelProps<ScanCorruptSettings>) {
  const { mode, count, rangeStart, rangeEnd, seed } = settings;
  const {
    canApply,
    isCorrupting,
    hasScanCorruption,
    reports,
    diagnostic,
    hasJpegOperations,
  } = editor.scanCorruption;
  const invalidCount =
    !Number.isInteger(count) || count < 1 || count > MAX_SCAN_CORRUPTION_BYTES;
  const invalidRange =
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeStart < 0 ||
    rangeEnd > 1 ||
    rangeStart >= rangeEnd;
  const disabled =
    !canApply || editor.isEncoding || invalidCount || invalidRange;

  return (
    <section className="inspector-section scan-corrupt-panel">
      <p className="channel-readout">Affects the encoded JPEG</p>
      <p className="scan-terminal-notice">
        A damaged JPG may not open in other apps.
      </p>
      <RadioChoiceGroup<ScanCorruptionMode>
        name="scan-corruption-mode"
        legend="Damage type"
        value={mode}
        options={[
          { value: "bit-flip", label: "Flip one bit" },
          { value: "byte-replacement", label: "Replace scan byte" },
        ]}
        onChange={(value) => onChangeSettings({ mode: value })}
        layout="inline"
      />
      <label className="coefficient-field tool-field">
        <span>Number of changes</span>
        <input
          type="number"
          min="1"
          max={MAX_SCAN_CORRUPTION_BYTES}
          step="1"
          value={count}
          aria-invalid={invalidCount}
          aria-describedby={invalidCount ? "damage-count-error" : undefined}
          onChange={(event) =>
            onChangeSettings({ count: Number(event.currentTarget.value) })
          }
        />
      </label>
      {invalidCount && (
        <p id="damage-count-error" className="field-error" role="status">
          Enter a whole number from 1 to {MAX_SCAN_CORRUPTION_BYTES}.
        </p>
      )}
      <details className="advanced-controls">
        <summary>Advanced settings</summary>
        <div className="advanced-control-content">
          <p className="coefficient-note">
            The range is a fraction of the entropy-coded scan. JPEG decoders can
            recover differently after a change.
          </p>
          {!hasJpegOperations && (
            <p className="coefficient-note">
              The first stage prepares a Standard JPG with the original
              quantized coefficients.
            </p>
          )}
          <div className="scan-range-fields">
            <label className="coefficient-field">
              <span>Scan range start (0–1)</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={rangeStart}
                aria-invalid={invalidRange}
                aria-describedby={
                  invalidRange ? "damage-range-error" : undefined
                }
                onChange={(event) =>
                  onChangeSettings({
                    rangeStart: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label className="coefficient-field">
              <span>Scan range end (0–1)</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={rangeEnd}
                aria-invalid={invalidRange}
                aria-describedby={
                  invalidRange ? "damage-range-error" : undefined
                }
                onChange={(event) =>
                  onChangeSettings({
                    rangeEnd: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
          </div>
          {invalidRange && (
            <p id="damage-range-error" className="field-error" role="status">
              Choose a start and a later end from 0 to 1.
            </p>
          )}
          <SeedField
            label="Seed"
            value={seed}
            onChange={(value) => onChangeSettings({ seed: Number(value) })}
          />
        </div>
      </details>
      {hasScanCorruption && (
        <details className="advanced-controls">
          <summary>Diagnostics</summary>
          <div className="advanced-control-content">
            {reports.map((report, index) => (
              <p
                className="scan-corruption-report"
                key={`${index}-${report.seed}`}
              >
                Stage {index + 1} · {report.mode} · seed {report.seed} · scan{" "}
                {formatOffset(report.scanStartOffset)}–
                {formatOffset(report.scanEndOffset)} · range{" "}
                {report.rangeStart.toFixed(2)}–{report.rangeEnd.toFixed(2)} ·{" "}
                {report.changedBytes} bytes / {report.changedBits} bits changed
              </p>
            ))}
            {diagnostic && (
              <div
                className={`scan-decode-diagnostic ${diagnostic.status === "complete" ? "is-complete" : "is-warning"}`}
                aria-label="JPEG decode completeness diagnostic"
              >
                <p>{getScanDecodeDiagnosticMessage(diagnostic)}</p>
                {getScanDecodeWarningLabels(diagnostic.warningFlags).map(
                  (warning) => (
                    <p key={warning}>Decoder warning · {warning}</p>
                  ),
                )}
              </div>
            )}
          </div>
        </details>
      )}
      {!canApply && !editor.isEncoding && (
        <p className="field-error" role="status">
          A ready JPG is needed to add a damage stage.
        </p>
      )}
      <div className="scan-corrupt-actions effect-actions">
        <button
          className="operation-button"
          type="button"
          disabled={disabled || reports.length >= MAX_SCAN_CORRUPTION_STAGES}
          onClick={() => editor.scanCorruption.apply(settings)}
        >
          Add damage stage
        </button>
        {hasScanCorruption && (
          <button
            className="operation-button secondary"
            type="button"
            disabled={disabled}
            onClick={() => editor.scanCorruption.updateLastStage(settings)}
          >
            Update last stage
          </button>
        )}
        {isCorrupting && (
          <button
            className="operation-button secondary"
            type="button"
            onClick={editor.scanCorruption.cancel}
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
