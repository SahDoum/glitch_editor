import type { ReactNode } from "react";
import { getMaskFromParameters, type SpatialMask } from "../document/masks";
import type { OperationRecord, JsonValue } from "../operations/schema";
import type { ScanCorruptionReport } from "../jpeg/scan-corruption";
import { getHistoryDisplayEntries } from "./workspace-state";

type OperationParameters = Readonly<Record<string, JsonValue>>;

interface OperationHistoryProps {
  operations: readonly OperationRecord[];
  scanCorruptionReports: readonly ScanCorruptionReport[];
  hasScanCorruption: boolean;
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

  const titlesByKind: Record<string, string> = {
    coefficients: "Coefficient glitch",
    "block-repeat": "Block copy / repeat",
    "block-permutation": "Block shuffle",
    "block-shift": "Local block shift",
    "block-transfer": "Block region transfer",
    quantization: "DQT matrix edit",
  };
  const kind = parameters ? getParameterValue(parameters, "kind") : undefined;
  return kind && titlesByKind[kind] ? titlesByKind[kind] : operation.type;
}

const parameterRenderers: Record<
  string,
  (parameters: OperationParameters) => ReactNode
> = {
  coefficients: (parameters) => (
    <>
      Component {getParameterValue(parameters, "componentIndex")} ·{" "}
      {getParameterValue(parameters, "mode")}{" "}
      {getParameterValue(parameters, "domain")} ·{" "}
      {getParameterValue(parameters, "frequencyBand")} · strength{" "}
      {getParameterValue(parameters, "strength")} · seed{" "}
      {getParameterValue(parameters, "seed")}
    </>
  ),
  "block-repeat": (parameters) => (
    <>
      Component {getParameterValue(parameters, "componentIndex")} · source (
      {getParameterValue(parameters, "sourceX")},{" "}
      {getParameterValue(parameters, "sourceY")}) · offset (
      {getParameterValue(parameters, "offsetX")},{" "}
      {getParameterValue(parameters, "offsetY")}) ·{" "}
      {getParameterValue(parameters, "repetitions")} copies
    </>
  ),
  "block-permutation": (parameters) => (
    <>
      Component {getParameterValue(parameters, "componentIndex")} · seed{" "}
      {getParameterValue(parameters, "seed")} · Fisher–Yates
    </>
  ),
  "block-shift": (parameters) => (
    <>
      Component {getParameterValue(parameters, "componentIndex")} · offset (
      {getParameterValue(parameters, "offsetX")},{" "}
      {getParameterValue(parameters, "offsetY")}) blocks
    </>
  ),
  "block-transfer": (parameters) => (
    <>
      Component {getParameterValue(parameters, "componentIndex")} ·{" "}
      {getParameterValue(parameters, "action")}{" "}
      {getParameterValue(parameters, "mode")} · source (
      {getParameterValue(parameters, "sourceX")},{" "}
      {getParameterValue(parameters, "sourceY")}) ·{" "}
      {getParameterValue(parameters, "width")} ×{" "}
      {getParameterValue(parameters, "height")} blocks · destination (
      {getParameterValue(parameters, "destinationX")},{" "}
      {getParameterValue(parameters, "destinationY")})
    </>
  ),
  quantization: (parameters) => (
    <>
      DQT {getParameterValue(parameters, "tableId")} ·{" "}
      {getParameterValue(parameters, "semantics")} ·{" "}
      {getParameterValue(parameters, "pattern")} · seed{" "}
      {getParameterValue(parameters, "seed")}
    </>
  ),
};

function describeMask(mask: SpatialMask): string {
  const shape = mask.shapes[0];
  if (!shape) return "Empty image-space mask";
  if (shape.kind === "rectangle") {
    return `Image-pixel rectangle · ${shape.width.toFixed(1)} × ${shape.height.toFixed(1)}`;
  }
  return `Image-pixel brush · radius ${shape.radius.toFixed(1)} px · ${shape.points.length} samples`;
}

function OperationParameters({
  operation,
  mask,
}: {
  operation: OperationRecord;
  mask: SpatialMask | null;
}) {
  const parameters = getOperationParameters(operation);
  const kind = parameters ? getParameterValue(parameters, "kind") : "";
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
    parameterRenderers[kind]?.(parameters)
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
  index,
  totalCount,
  hasScanCorruption,
  onSetEnabled,
  onMove,
  onDelete,
  onRestoreMask,
}: {
  operation: OperationRecord;
  index: number;
  totalCount: number;
  hasScanCorruption: boolean;
  onSetEnabled: OperationHistoryProps["onSetEnabled"];
  onMove: OperationHistoryProps["onMove"];
  onDelete: OperationHistoryProps["onDelete"];
  onRestoreMask: OperationHistoryProps["onRestoreMask"];
}) {
  const mask = getMaskFromParameters(operation.parameters);
  const parameters = getOperationParameters(operation);

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
            disabled={hasScanCorruption}
            onChange={(event) =>
              onSetEnabled(operation.id, event.currentTarget.checked)
            }
          />
          <span>{getOperationTitle(operation, parameters)}</span>
        </label>
        <span className="operation-status">{operation.status}</span>
      </div>

      <OperationParameters operation={operation} mask={mask} />

      <div className="operation-actions">
        {mask && (
          <button
            className="operation-button secondary"
            type="button"
            disabled={hasScanCorruption}
            title="Replace the current draft with a copy of this mask"
            onClick={() => onRestoreMask(mask)}
          >
            Restore mask
          </button>
        )}
        <button
          className="operation-button secondary"
          type="button"
          disabled={hasScanCorruption || index === totalCount - 1}
          aria-label="Move operation up"
          onClick={() => onMove(operation.id, index + 1)}
        >
          ↑
        </button>
        <button
          className="operation-button secondary"
          type="button"
          disabled={hasScanCorruption || index === 0}
          aria-label="Move operation down"
          onClick={() => onMove(operation.id, index - 1)}
        >
          ↓
        </button>
        <button
          className="operation-button danger"
          type="button"
          disabled={hasScanCorruption}
          aria-label="Delete operation"
          onClick={() => onDelete(operation.id)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export function OperationHistoryPanel({
  operations,
  scanCorruptionReports,
  hasScanCorruption,
  onSetEnabled,
  onMove,
  onDelete,
  onRestoreMask,
  onReset,
}: OperationHistoryProps) {
  return (
    <section className="inspector-section operation-stack">
      <p className="operation-description">
        New operations appear at the top. Enabled operations replay from the
        bottom up; reordering recomputes later state.
      </p>
      {hasScanCorruption && (
        <p className="scan-terminal-notice" role="status">
          Entropy corruption is a terminal byte-domain phase. Undo every Scan
          Corrupt stage before changing coefficient or DQT operations.
        </p>
      )}
      {scanCorruptionReports.length > 0 && (
        <ol className="scan-corruption-history">
          {scanCorruptionReports.map((report, index) => (
            <li key={`${index}-${report.seed}`}>
              Scan Corrupt · {report.mode} · seed {report.seed} ·{" "}
              {report.changedBytes} bytes / {report.changedBits} bits
            </li>
          ))}
        </ol>
      )}
      {operations.length > 0 ? (
        <ol className="operation-list">
          {getHistoryDisplayEntries(operations).map(({ operation, index }) => (
            <OperationItem
              key={operation.id}
              operation={operation}
              index={index}
              totalCount={operations.length}
              hasScanCorruption={hasScanCorruption}
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
        disabled={operations.length === 0 && !hasScanCorruption}
        onClick={onReset}
      >
        Reset to original
      </button>
    </section>
  );
}
