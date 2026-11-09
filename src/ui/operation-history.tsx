import React from "react";

// --- ТИПЫ (можно заменить на реальные из вашего проекта) ---
interface Operation {
  id: string;
  type: string;
  status: string;
  enabled: boolean;
  parameters: unknown;
}

interface OperationHistoryListProps {
  historyDocument: {
    operations: Operation[];
  } | null;
  hasScanCorruption: boolean;
  getHistoryDisplayEntries: (operations: Operation[]) => Array<{ operation: Operation; index: number }>;
  getMaskFromParameters: (params: unknown) => any;
  describeMask: (mask: any) => string;
  mutateHistory: (callback: (history: any) => void) => void;
  restoreHistoryMask: (mask: any) => void;
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function getValidParameters(parameters: unknown): Record<string, any> | null {
  return typeof parameters === "object" && parameters !== null && !Array.isArray(parameters)
    ? (parameters as Record<string, any>)
    : null;
}

// --- СЛОВАРИ ДЛЯ ЗАГОЛОВКОВ ---

const operationTitleMap: Record<string, string> = {
  coefficients: "Coefficient glitch",
  "block-repeat": "Block copy / repeat",
  "block-permutation": "Block shuffle",
  "block-shift": "Local block shift",
  "block-transfer": "Block region transfer",
  quantization: "DQT matrix edit",
};

function getOperationTitle(operation: Operation, parameters: Record<string, any> | null): string {
  if (operation.type === "spatial/apply-mask") {
    return `Saved mask · ${parameters?.name ?? ""}`;
  }
  if (operation.type === "jpeg/glitch/coefficient-recipe") {
    return `Recipe · ${parameters?.name ?? ""}`;
  }

  const kind = parameters?.kind;
  if (kind && operationTitleMap[kind]) {
    return operationTitleMap[kind];
  }

  return operation.type;
}

// --- СЛОВАРИ СТРАТЕГИЙ РЕНДЕРИНГА ПАРАМЕТРОВ ---

const parameterRenderers: Record<string, (p: Record<string, any>, extra: { mask: any }) => React.ReactNode> = {
  coefficients: (p) => (
    <>Component {p.componentIndex} · {p.mode} {p.domain} · {p.frequencyBand} · strength {p.strength} · seed {p.seed}</>
  ),

  "block-repeat": (p) => (
    <>Component {p.componentIndex} · source ({p.sourceX}, {p.sourceY}) · offset ({p.offsetX}, {p.offsetY}) · {p.repetitions} copies</>
  ),

  "block-permutation": (p) => (
    <>Component {p.componentIndex} · seed {p.seed} · Fisher–Yates</>
  ),

  "block-shift": (p) => (
    <>Component {p.componentIndex} · offset ({p.offsetX}, {p.offsetY}) blocks</>
  ),

  "block-transfer": (p) => (
    <>Component {p.componentIndex} · {p.action} {p.mode} · source ({p.sourceX}, {p.sourceY}) · {p.width} × {p.height} blocks · destination ({p.destinationX}, {p.destinationY})</>
  ),

  quantization: (p) => (
    <>DQT {p.tableId} · {p.semantics} · {p.pattern} · seed {p.seed}</>
  ),
};

const specialOperationRenderers: Record<string, (op: Operation, p: Record<string, any>, extra: { mask: any }) => React.ReactNode> = {
  "jpeg/glitch/coefficient-recipe": (_op, p, { mask }) => {
    const steps = p.steps;
    if (!Array.isArray(steps)) return null;
    return <>{steps.length} ordered coefficient steps · mask snapshot {mask?.id?.slice(0, 8)}</>;
  },
};

// --- КОМПОНЕНТ ОТОБРАЖЕНИЯ ПАРАМЕТРОВ ---

interface OperationParametersProps {
  operation: Operation;
  parameters: Record<string, any> | null;
  mask: any;
  describeMask: (mask: any) => string;
}

const OperationParameters: React.FC<OperationParametersProps> = ({ operation, parameters, mask, describeMask }) => {
  if (!parameters) {
    return mask ? <p className="operation-parameters">{describeMask(mask)}</p> : null;
  }

  const renderSpecial = specialOperationRenderers[operation.type];
  const renderByKind = parameters.kind ? parameterRenderers[parameters.kind] : null;

  const content = renderSpecial
    ? renderSpecial(operation, parameters, { mask })
    : renderByKind
      ? renderByKind(parameters, { mask })
      : null;

  return (
    <>
      {mask && <p className="operation-parameters">{describeMask(mask)}</p>}
      {content && <p className="operation-parameters">{content}</p>}
    </>
  );
};

// --- КОМПОНЕНТ ОТДЕЛЬНОГО ЭЛЕМЕНТА СПИСКА ---

interface OperationItemProps {
  operation: Operation;
  index: number;
  totalCount: number;
  hasScanCorruption: boolean;
  mutateHistory: (callback: (history: any) => void) => void;
  restoreHistoryMask: (mask: any) => void;
  getMaskFromParameters: (params: unknown) => any;
  describeMask: (mask: any) => string;
}

const OperationItem: React.FC<OperationItemProps> = ({
  operation,
  index,
  totalCount,
  hasScanCorruption,
  mutateHistory,
  restoreHistoryMask,
  getMaskFromParameters,
  describeMask,
}) => {
  const mask = getMaskFromParameters(operation.parameters);
  const parameters = getValidParameters(operation.parameters);
  const title = getOperationTitle(operation, parameters);

  return (
    <li className="operation-entry" key={operation.id} data-enabled={operation.enabled}>
      <div className="operation-entry-heading">
        <label className="operation-enabled">
          <input
            type="checkbox"
            checked={operation.enabled}
            disabled={hasScanCorruption}
            onChange={(event) =>
              mutateHistory((history) => history.setEnabled(operation.id, event.currentTarget.checked))
            }
          />
          <span>{title}</span>
        </label>
        <span className="operation-status">{operation.status}</span>
      </div>

      <OperationParameters
        operation={operation}
        parameters={parameters}
        mask={mask}
        describeMask={describeMask}
      />

      <div className="operation-actions">
        {mask && (
          <button
            className="operation-button secondary"
            type="button"
            disabled={hasScanCorruption}
            title="Replace the current draft with a copy of this mask"
            onClick={() => restoreHistoryMask(mask)}
          >
            Restore mask
          </button>
        )}
        <button
          className="operation-button secondary"
          type="button"
          disabled={hasScanCorruption || index === totalCount - 1}
          aria-label="Move operation up"
          onClick={() => mutateHistory((history) => history.move(operation.id, index + 1))}
        >
          ↑
        </button>
        <button
          className="operation-button secondary"
          type="button"
          disabled={hasScanCorruption || index === 0}
          aria-label="Move operation down"
          onClick={() => mutateHistory((history) => history.move(operation.id, index - 1))}
        >
          ↓
        </button>
        <button
          className="operation-button danger"
          type="button"
          disabled={hasScanCorruption}
          aria-label="Delete operation"
          onClick={() => mutateHistory((history) => history.delete(operation.id))}
        >
          Delete
        </button>
      </div>
    </li>
  );
};

// --- ГЛАВНЫЙ ЭКСПОРТИРУЕМЫЙ КОМПОНЕНТ ---

export const OperationHistoryList: React.FC<OperationHistoryListProps> = ({
  historyDocument,
  hasScanCorruption,
  getHistoryDisplayEntries,
  getMaskFromParameters,
  describeMask,
  mutateHistory,
  restoreHistoryMask,
}) => {
  if (!historyDocument?.operations?.length) {
    return null;
  }

  return (
    <ol className="operation-list">
      {getHistoryDisplayEntries(historyDocument.operations).map(({ operation, index }) => (
        <OperationItem
          key={operation.id}
          operation={operation}
          index={index}
          totalCount={historyDocument.operations.length}
          hasScanCorruption={hasScanCorruption}
          mutateHistory={mutateHistory}
          restoreHistoryMask={restoreHistoryMask}
          getMaskFromParameters={getMaskFromParameters}
          describeMask={describeMask}
        />
      ))}
    </ol>
  );
};
