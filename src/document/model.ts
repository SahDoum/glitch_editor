import { failure, success, type Result } from "../shared/result";
import type { JpegInspection } from "../jpeg/inspect";
import type { OperationRecord } from "../operations/schema";
import type { SpatialSelection } from "./masks";

export class OriginalAsset {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType = "image/jpeg";
  readonly sha256: string;
  readonly byteLength: number;
  readonly #bytes: Uint8Array;

  private constructor(fileName: string, sha256: string, bytes: Uint8Array) {
    this.id = crypto.randomUUID();
    this.fileName = fileName;
    this.sha256 = sha256;
    this.byteLength = bytes.byteLength;
    this.#bytes = bytes.slice();
    Object.freeze(this);
  }

  static create(input: {
    fileName: string;
    sha256: string;
    bytes: Uint8Array;
  }): Result<OriginalAsset> {
    if (
      input.fileName.trim().length === 0 ||
      !/^[\da-f]{64}$/i.test(input.sha256) ||
      input.bytes.byteLength === 0
    ) {
      return failure({
        code: "INVALID_INPUT",
        message: "The original JPEG asset metadata or bytes are invalid.",
      });
    }

    return success(
      new OriginalAsset(
        input.fileName,
        input.sha256.toLowerCase(),
        input.bytes,
      ),
    );
  }

  readBytes(): Uint8Array {
    return this.#bytes.slice();
  }
}

export interface ProjectDocument<State> {
  readonly id: string;
  readonly originalAsset: OriginalAsset;
  readonly inspection: JpegInspection;
  readonly revision: number;
  readonly currentState: State;
  readonly selection: SpatialSelection | null;
  readonly operations: readonly OperationRecord[];
}

export function createProjectDocument<State>(
  originalAsset: OriginalAsset,
  inspection: JpegInspection,
  initialState: State,
): ProjectDocument<State> {
  return Object.freeze({
    id: crypto.randomUUID(),
    originalAsset,
    inspection,
    revision: 0,
    currentState: initialState,
    selection: null,
    operations: Object.freeze([]),
  });
}
