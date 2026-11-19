export interface EditorHandlers {
  readonly changeComponent: (index: number) => void;
  readonly setError: (message: string) => void;
  readonly apply: (patch?: object) => void;
  readonly preview: (patch?: object) => void;
  readonly discardPreview: () => void;
  readonly applyScan: (settings: object) => void;
  readonly updateLastScan: (settings: object) => void;
  readonly cancelScan: () => void;
}

/**
 * Gives effect panels handlers with a stable identity that always forward to
 * the latest application handlers, so panels never hold stale closures.
 */
export class EditorBridge {
  private latest: EditorHandlers | null = null;

  update(handlers: EditorHandlers): void {
    this.latest = handlers;
  }

  readonly changeComponent = (index: number): void =>
    this.latest?.changeComponent(index);
  readonly setError = (message: string): void => this.latest?.setError(message);
  readonly apply = (patch?: object): void => this.latest?.apply(patch);
  readonly preview = (patch?: object): void => this.latest?.preview(patch);
  readonly discardPreview = (): void => this.latest?.discardPreview();
  readonly applyScan = (settings: object): void =>
    this.latest?.applyScan(settings);
  readonly updateLastScan = (settings: object): void =>
    this.latest?.updateLastScan(settings);
  readonly cancelScan = (): void => this.latest?.cancelScan();
}
