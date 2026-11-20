import type { SpatialMask } from "../document/masks";
import type { OperationHistory } from "../operations/history";
import {
  isScanCorruptionParameters,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
} from "../jpeg/scan-corruption";
import { failure, success, type Result } from "../shared/result";
import type { JpegEditableState } from "./jpeg-document";
import { ScanCorruptionHistory } from "./scan-corruption";

type JpegHistory = OperationHistory<JpegEditableState>;
type HistoryResult = ReturnType<JpegHistory["add"]>;

/** Owns the two editing phases and validates transitions before either history mutates. */
export interface PendingScanTransition {
  readonly stages: readonly ScanCorruptionParameters[];
  commit(): boolean;
}

export type SessionTransition =
  | { readonly kind: "coefficient"; readonly result: HistoryResult }
  | { readonly kind: "scan"; readonly transition: PendingScanTransition };

export class EditorDocumentSession {
  private currentHistory: JpegHistory | null = null;
  get history(): JpegHistory | null {
    return this.currentHistory;
  }
  readonly scanHistory = new ScanCorruptionHistory();

  open(history: JpegHistory): void {
    this.currentHistory = history;
    this.scanHistory.clear();
  }

  get coefficientPhase(): boolean {
    return this.scanHistory.activeStages.length === 0;
  }

  mutate(command: (history: JpegHistory) => HistoryResult): HistoryResult {
    if (!this.history)
      return failure({
        code: "INVALID_INPUT",
        message: "Open a JPEG before editing.",
      });
    if (!this.coefficientPhase)
      return failure({
        code: "INVALID_INPUT",
        message: "Undo the damage stages to edit earlier effects.",
      });
    const result = command(this.history);
    if (result.ok) this.scanHistory.clear();
    return result;
  }

  reset(): HistoryResult {
    if (!this.history)
      return failure({
        code: "INVALID_INPUT",
        message: "Open a JPEG before editing.",
      });
    const result = this.history.resetToOriginal();
    if (result.ok) this.scanHistory.clear();
    return result;
  }

  private pendingScan(
    stages: readonly ScanCorruptionParameters[],
    commit: () => boolean,
  ): PendingScanTransition {
    const history = this.history;
    const snapshot = history?.snapshot;
    const baseStages = JSON.stringify(this.scanHistory.activeStages);
    const executed = Object.freeze(
      stages.map((stage) => Object.freeze({ ...stage })),
    );
    let committed = false;
    return Object.freeze({
      stages: executed,
      commit: () => {
        if (
          committed ||
          history !== this.history ||
          snapshot !== this.history?.snapshot ||
          baseStages !== JSON.stringify(this.scanHistory.activeStages)
        )
          return false;
        if (!commit()) return false;
        committed = true;
        return true;
      },
    });
  }

  prepareScan(
    parameters: ScanCorruptionParameters,
    replaceLast = false,
  ): Result<PendingScanTransition> {
    const active = this.scanHistory.activeStages;
    const stages = replaceLast
      ? [...active.slice(0, -1), parameters]
      : [...active, parameters];
    if (
      !this.history ||
      !isScanCorruptionParameters(parameters) ||
      (replaceLast && active.length === 0) ||
      stages.length > MAX_SCAN_CORRUPTION_STAGES
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "The JPEG Damage stage or stage count is invalid.",
      });
    }
    const transition: PendingScanTransition = this.pendingScan(
      stages,
      () => this.scanHistory.commitStages(transition.stages).ok,
    );
    return success(transition);
  }

  restoreScanStages(
    stages: readonly ScanCorruptionParameters[],
  ): Result<undefined> {
    if (
      stages.length > MAX_SCAN_CORRUPTION_STAGES ||
      !stages.every(isScanCorruptionParameters)
    )
      return failure({
        code: "INVALID_INPUT",
        message: "The saved JPEG Damage stages are invalid.",
      });
    this.scanHistory.clear();
    // Each restored stage remains independently undoable.
    for (const stage of stages) {
      const result = this.scanHistory.record(stage);
      if (!result.ok) return result;
    }
    return success(undefined);
  }

  undo(): SessionTransition | null {
    if (this.scanHistory.canUndo)
      return {
        kind: "scan",
        transition: this.pendingScan(this.scanHistory.undoTarget, () =>
          this.scanHistory.commitUndo(),
        ),
      };
    if (!this.history?.canUndo) return null;
    return {
      kind: "coefficient",
      result: this.mutate((history) => history.undo()),
    };
  }

  redo(): SessionTransition | null {
    if (this.scanHistory.canRedo)
      return {
        kind: "scan",
        transition: this.pendingScan(this.scanHistory.redoTarget, () =>
          this.scanHistory.commitRedo(),
        ),
      };
    if (!this.history?.canRedo || !this.coefficientPhase) return null;
    return {
      kind: "coefficient",
      result: this.mutate((history) => history.redo()),
    };
  }

  /** Capture all serializable edits together before any asynchronous save work. */
  snapshotEdits(draftMask: SpatialMask | null) {
    return Object.freeze({
      operations: this.history?.snapshot.operations ?? [],
      draftMask,
      scanCorruptionStages: this.scanHistory.activeStages,
    });
  }
}
