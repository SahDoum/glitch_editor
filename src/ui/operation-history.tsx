import { getMaskFromParameters, type SpatialMask } from "../document/masks";
import type { OperationRecord, JsonValue } from "../operations/schema";
import type { ScanCorruptionReport } from "../jpeg/scan-corruption";
import { areaToolForMask, getHistoryDisplayEntries } from "./workspace-state";
import { getMaskToolView } from "../features/canvas-tools/registry";
import {
  findOperationPresentation,
  getEffect,
  getScanCorruptionEffect,
} from "../features/effects/registry";
import type { OperationParameters } from "../features/effects/types";
import { EffectIcon } from "./effect-icon";

interface OperationHistoryProps {
  operations: readonly OperationRecord[];
  effectIds: Readonly<Record<string, string>>;
  scanCorruptionReports: readonly ScanCorruptionReport[];
  hasScanCorruption: boolean;
  isBusy: boolean;
  onSetEnabled: (operationId: string, enabled: boolean) => void;
  onMove: (operationId: string, index: number) => void;
  onDelete: (operationId: string) => void;
  onRestoreMask: (mask: SpatialMask) => void;
  onReset: () => void;
}

function isParameterRecord(value: JsonValue): value is OperationParameters {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getParameterValue(
  parameters: OperationParameters,
  key: string,
): string {
  const value = parameters[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "—";
}

function getOperationParameters(operation: OperationRecord) {
  return isParameterRecord(operation.parameters) ? operation.parameters : null;
}

function getOperationTitle(
  operation: OperationRecord,
  parameters: OperationParameters | null,
): string {
  const namedTitles: Record<string, (name: string) => string> = {
    "spatial/apply-mask": (name) => `Saved mask · ${name}`,
    "jpeg/glitch/coefficient-recipe": (name) => `Recipe · ${name}`,
  };
  const namedTitle = namedTitles[operation.type];
  if (namedTitle) {
    return namedTitle(parameters ? getParameterValue(parameters, "name") : "");
  }

  const presentation = parameters
    ? findOperationPresentation(parameters)
    : null;
  if (presentation) return presentation.title;
  const mode = parameters ? getParameterValue(parameters, "mode") : "—";
  return mode === "—" ? operation.type : mode;
}

function describeMask(mask: SpatialMask): string {
  const shape = mask.shapes[0];
  if (!shape) return "Empty image-space mask";
  if (shape.kind === "rectangle") {
    return `Image-pixel rectangle · ${shape.width.toFixed(1)} × ${shape.height.toFixed(1)}`;
  }
  return `Image-pixel brush · radius ${shape.radius.toFixed(1)} px · ${shape.points.length} samples`;
}

function OperationDetails({
  operation,
  mask,
}: {
  operation: OperationRecord;
  mask: SpatialMask | null;
}) {
  const parameters = getOperationParameters(operation);
  const recipeSteps =
    operation.type === "jpeg/glitch/coefficient-recipe"
      ? parameters?.steps
      : undefined;
  const details = Array.isArray(recipeSteps) ? (
    <>
      {recipeSteps.length} ordered coefficient steps · mask snapshot{" "}
      {mask?.id.slice(0, 8)}
    </>
  ) : parameters ? (
    findOperationPresentation(parameters)?.descriptor.describe(parameters)
  ) : null;

  return (
    <>
      {mask && <p className="operation-parameters">{describeMask(mask)}</p>}
      {details && <p className="operation-parameters">{details}</p>}
    </>
  );
}

function OperationItem({
  operation,
  effectId,
  index,
  totalCount,
  disabled,
  onSetEnabled,
  onMove,
  onDelete,
  onRestoreMask,
}: {
  operation: OperationRecord;
  effectId: string | undefined;
  index: number;
  totalCount: number;
  disabled: boolean;
  onSetEnabled: OperationHistoryProps["onSetEnabled"];
  onMove: OperationHistoryProps["onMove"];
  onDelete: OperationHistoryProps["onDelete"];
  onRestoreMask: OperationHistoryProps["onRestoreMask"];
}) {
  const mask = getMaskFromParameters(operation.parameters);
  const parameters = getOperationParameters(operation);
  const presentation = parameters
    ? findOperationPresentation(parameters)
    : null;
  const effect = effectId ? getEffect(effectId)?.view : undefined;
  const iconPaths = effect?.iconPaths ?? presentation?.view?.iconPaths;

  return (
    <li
      className="operation-entry"
      key={operation.id}
      data-enabled={operation.enabled}
    >
      <div className="operation-entry-heading">
        <label className="operation-enabled">
          <input
            type="checkbox"
            checked={operation.enabled}
            disabled={disabled}
            onChange={(event) =>
              onSetEnabled(operation.id, event.currentTarget.checked)
            }
          />
          {iconPaths && (
            <EffectIcon className="operation-effect-icon" paths={iconPaths} />
          )}
          <span>
            {effect?.label ?? getOperationTitle(operation, parameters)}
          </span>
        </label>
        {mask && (
          <span className="operation-status">
            {getMaskToolView(areaToolForMask(mask)).label}
          </span>
        )}
        {operation.status !== "applied" && (
          <span className="operation-status">{operation.status}</span>
        )}
      </div>

      <details className="operation-entry-details">
        <summary>Step details</summary>
        <OperationDetails operation={operation} mask={mask} />
        {operation.diagnostics?.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
        <div className="operation-actions">
          {mask && (
            <button
              className="operation-button secondary"
              type="button"
              disabled={disabled}
              title="Replace the current draft with a copy of this mask"
              onClick={() => onRestoreMask(mask)}
            >
              Use this area
            </button>
          )}
          <button
            className="operation-button secondary"
            type="button"
            disabled={disabled || index === totalCount - 1}
            onClick={() => onMove(operation.id, index + 1)}
          >
            Move later
          </button>
          <button
            className="operation-button secondary"
            type="button"
            disabled={disabled || index === 0}
            onClick={() => onMove(operation.id, index - 1)}
          >
            Move earlier
          </button>
          <button
            className="operation-button danger"
            type="button"
            disabled={disabled}
            onClick={() => onDelete(operation.id)}
          >
            Delete
          </button>
        </div>
      </details>
    </li>
  );
}

export function OperationHistoryPanel({
  operations,
  effectIds,
  scanCorruptionReports,
  hasScanCorruption,
  isBusy,
  onSetEnabled,
  onMove,
  onDelete,
  onRestoreMask,
  onReset,
}: OperationHistoryProps) {
  const scanView = getScanCorruptionEffect()?.view;
  return (
    <section className="inspector-section operation-stack">
      {hasScanCorruption && (
        <p className="scan-terminal-notice" role="status">
          Undo the damage stages to edit earlier effects.
        </p>
      )}
      {scanCorruptionReports.length > 0 && (
        <ol className="scan-corruption-history">
          {getHistoryDisplayEntries(scanCorruptionReports).map(
            ({ operation: report, index }) => (
              <li key={`${index}-${report.seed}`}>
                {scanView && (
                  <EffectIcon
                    className="operation-effect-icon"
                    paths={scanView.iconPaths}
                  />
                )}
                {scanView?.label} · {report.mode} · seed {report.seed} ·{" "}
                {report.changedBytes} bytes / {report.changedBits} bits
              </li>
            ),
          )}
        </ol>
      )}
      {operations.length > 0 ? (
        <ol className="operation-list">
          {getHistoryDisplayEntries(operations).map(({ operation, index }) => (
            <OperationItem
              key={operation.id}
              operation={operation}
              effectId={effectIds[operation.id]}
              index={index}
              totalCount={operations.length}
              disabled={hasScanCorruption || isBusy}
              onSetEnabled={onSetEnabled}
              onMove={onMove}
              onDelete={onDelete}
              onRestoreMask={onRestoreMask}
            />
          ))}
        </ol>
      ) : (
        <p className="operation-empty">Apply an effect to start history.</p>
      )}
      <button
        className="operation-reset"
        type="button"
        disabled={isBusy || (operations.length === 0 && !hasScanCorruption)}
        onClick={onReset}
      >
        Remove all effects
      </button>
    </section>
  );
}
