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
  label: "Scan Corrupt",
  description:
    "Experiment on the encoded entropy scan after coefficient/DQT encoding.",
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
  const { isEncoding } = editor;
  const {
    canApply,
    isCorrupting,
    hasScanCorruption,
    reports,
    diagnostic,
    previewError,
    hasJpegOperations,
  } = editor.scanCorruption;
  const onChangeMode = (value: ScanCorruptionMode) =>
    onChangeSettings({ mode: value });
  const onChangeCount = (value: number) => onChangeSettings({ count: value });
  const onChangeRangeStart = (value: number) =>
    onChangeSettings({ rangeStart: value });
  const onChangeRangeEnd = (value: number) =>
    onChangeSettings({ rangeEnd: value });
  const onChangeSeed = (value: number) => onChangeSettings({ seed: value });
  const onApply = () => editor.scanCorruption.apply(settings);
  const onUpdateLastStage = () =>
    editor.scanCorruption.updateLastStage(settings);
  const onCancel = editor.scanCorruption.cancel;
  return (
    <section className="inspector-section scan-corrupt-panel">
      <p className="operation-description">
        A bounded byte-domain experiment applied after the coefficient/DQT JPEG
        encoder. This does not target pixels, DCT blocks, MCUs, or source-file
        offsets. The decoder may show a different region or fail entirely. The
        original and clean encoded JPEG remain unchanged.
      </p>
      {!canApply && (
        <p className="operation-empty" role="status">
          {isEncoding
            ? "The clean JPEG is being encoded. Scan Corrupt will be available when encoding finishes."
            : "The clean JPEG is unavailable. Resolve the encoding error before applying Scan Corrupt."}
        </p>
      )}
      {!hasJpegOperations && (
        <p className="operation-empty">
          Applying Scan Corrupt first re-encodes the source as a baseline JPEG
          without changing its coefficients.
        </p>
      )}
      <RadioChoiceGroup<ScanCorruptionMode>
        name="scan-corruption-mode"
        legend="Corruption mode"
        value={mode}
        options={[
          { value: "bit-flip", label: "Flip one bit" },
          { value: "byte-replacement", label: "Replace entropy byte" },
        ]}
        onChange={onChangeMode}
        layout="inline"
      />
      <label className="coefficient-field tool-field">
        <span>Changed bytes (1–{MAX_SCAN_CORRUPTION_BYTES})</span>
        <input
          type="number"
          min="1"
          max={MAX_SCAN_CORRUPTION_BYTES}
          step="1"
          value={count}
          onChange={(event) => onChangeCount(Number(event.currentTarget.value))}
        />
      </label>
      <div className="scan-range-fields">
        <label className="coefficient-field">
          <span>Scan range start (0–1)</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={rangeStart}
            onChange={(event) =>
              onChangeRangeStart(Number(event.currentTarget.value))
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
            onChange={(event) =>
              onChangeRangeEnd(Number(event.currentTarget.value))
            }
          />
        </label>
      </div>
      <SeedField
        label="Unsigned 32-bit seed"
        value={seed}
        onChange={(value) => onChangeSeed(Number(value))}
      />
      <div className="scan-corrupt-actions">
        <button
          className="operation-button"
          type="button"
          disabled={
            !canApply ||
            isEncoding ||
            reports.length >= MAX_SCAN_CORRUPTION_STAGES
          }
          onClick={onApply}
        >
          Apply scan corruption
        </button>
        {hasScanCorruption && (
          <button
            className="operation-button secondary"
            type="button"
            disabled={isEncoding}
            onClick={onUpdateLastStage}
          >
            Update last stage
          </button>
        )}
        {isCorrupting && (
          <button
            className="operation-button secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
      <p className="operation-parameters" role="status">
        {hasScanCorruption
          ? `Stage ${reports.length} of ${MAX_SCAN_CORRUPTION_STAGES} · ${isEncoding ? "corrupting and checking decode…" : previewError ? "preview decode failed" : "corruption complete · preview decoded"}`
          : "No entropy-stream stage applied."}
      </p>
      {reports.map((report, index) => (
        <p className="scan-corruption-report" key={`${index}-${report.seed}`}>
          Stage {index + 1} · {report.mode} · seed {report.seed} · scan{" "}
          {formatOffset(report.scanStartOffset)}–
          {formatOffset(report.scanEndOffset)} · range{" "}
          {report.rangeStart.toFixed(2)}–{report.rangeEnd.toFixed(2)} ·{" "}
          {report.changedBytes} bytes / {report.changedBits} bits changed
        </p>
      ))}
      {hasScanCorruption && diagnostic && (
        <div
          className={`scan-decode-diagnostic ${diagnostic.status === "complete" ? "is-complete" : "is-warning"}`}
          role="status"
          aria-label="JPEG decode completeness diagnostic"
        >
          <p>{getScanDecodeDiagnosticMessage(diagnostic)}</p>
          {getScanDecodeWarningLabels(diagnostic.warningFlags).map(
            (warning) => (
              <p key={warning}>Decoder warning: {warning}.</p>
            ),
          )}
          <p>
            This diagnostic reports libjpeg-turbo only. Other JPEG decoders may
            recover differently; reading all rows here does not guarantee
            identical display in other applications.
          </p>
        </div>
      )}
    </section>
  );
}
