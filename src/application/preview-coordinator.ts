export interface PreviewRequestToken {
  readonly requestId: number;
  readonly documentRevision: number;
}

export type PreviewRequestResult<Value> =
  | {
      readonly status: "current";
      readonly documentRevision: number;
      readonly value: Value;
    }
  | {
      readonly status: "stale";
      readonly documentRevision: number;
    };

export class PreviewCoordinator {
  private latestRequestId = 0;

  begin(documentRevision: number): PreviewRequestToken {
    this.latestRequestId += 1;
    return Object.freeze({
      requestId: this.latestRequestId,
      documentRevision,
    });
  }

  isCurrent(
    token: PreviewRequestToken,
    currentDocumentRevision: number,
  ): boolean {
    return (
      token.requestId === this.latestRequestId &&
      token.documentRevision === currentDocumentRevision
    );
  }

  cancel(): void {
    this.latestRequestId += 1;
  }

  async run<Value>(
    documentRevision: number,
    getCurrentRevision: () => number,
    compute: () => Promise<Value>,
  ): Promise<PreviewRequestResult<Value>> {
    const token = this.begin(documentRevision);
    const value = await compute();
    if (!this.isCurrent(token, getCurrentRevision())) {
      return { status: "stale", documentRevision };
    }
    return { status: "current", documentRevision, value };
  }
}
