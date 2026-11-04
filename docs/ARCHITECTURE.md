# Architecture — JPEG Glitch Editor

**Status:** proposed baseline  
**Scope:** desktop-oriented, client-side browser application  
**Primary principle:** keep the original JPEG bytes, decoded preview, editable JPEG representation, and operation history as distinct things.

## 1. Architectural goals

1. Make JPEG-domain edits explicit and reproducible.
2. Keep UI code independent of JPEG binary layout and codec internals.
3. Preserve the exact original file for reset and comparison.
4. Make operations non-destructive and replayable.
5. Isolate expensive parsing, coefficient processing, and encoding from the UI thread.
6. Make unsupported JPEG features fail explicitly rather than silently producing misleading output.
7. Treat entropy-stream and raw-byte manipulation as a separate experimental subsystem.

## 2. High-level modules

```text
Browser UI (React + TypeScript)
        |
        v
Application / Document Controller
        |
        +-------------------+
        |                   |
        v                   v
Document Model         Operation Engine
        |                   |
        |             Operation Registry
        |                   |
        +---------+---------+
                  |
                  v
             JPEG Facade
                  |
       +----------+-----------+
       |          |           |
       v          v           v
    Parser    Coefficient   Encoder /
              Adapter      Stream Writer
       |          |           |
       +----------+-----------+
                  |
             Web Workers
                  |
          WASM / native codec
```

### `ui/`

Canvas, panels, tool controls, dialogs, keyboard shortcuts, overlays. UI must not parse JPEG markers or mutate coefficient arrays directly.

### `application/`

Coordinates import, document lifecycle, selection, operation dispatch, preview requests, export, and error presentation.

### `document/`

Owns immutable source assets, document metadata, current editable representation, masks/selections, operation stack, and revision identifiers.

### `jpeg/`

JPEG-specific interfaces and adapters: marker parser, frame/scan metadata, coefficient access, encoding, validation, and codec capability reporting.

### `operations/`

Typed, versioned operations. Each operation declares its input domain, parameters, compatibility requirements, deterministic behavior, and execution strategy.

### `workers/`

Worker entry points and message protocol. CPU-heavy work must not block pointer interaction or canvas rendering.

### `project/`

Project serialization, schema migration, local persistence, and asset packaging.

## 3. Core representations

Do not collapse these into one generic `image` object.

- **OriginalAsset:** exact imported bytes, filename, MIME type, cryptographic digest if available.
- **JpegStructure:** parsed markers, frame components, sampling factors, quantization/Huffman tables, scans, restart interval, coding process and parser diagnostics.
- **CoefficientDocument:** quantized coefficient arrays plus the metadata required to interpret them correctly.
- **PreviewImage:** decoded pixel buffer and the revision from which it was generated.
- **Operation:** immutable, versioned description of an edit.
- **ProjectDocument:** references the original asset and contains editable state, masks, operations, and project metadata.

The original bytes are authoritative for reset and original export. A preview is never the authoritative JPEG representation.

Milestone 3 implements `OriginalAsset` with private byte storage and
copy-returning reads, plus an immutable `ProjectDocument` snapshot. The
editable document tracks its monotonic revision, selected image-pixel region,
and an operation-derived mask state separately from the source JPEG.
Selections and masks remain spatial controls; they are not DCT-block
coordinates or coefficient edits.

## 4. JPEG engine boundary

Expose a stable facade. The rest of the app should depend on these conceptual operations, not a particular codec library:

```ts
interface JpegEngine {
  inspect(bytes: Uint8Array): Promise<JpegInspection>;
  decodePreview(bytes: Uint8Array): Promise<PreviewImage>;
  decodeCoefficients(bytes: Uint8Array): Promise<CoefficientDocument>;
  encodeCoefficients(
    document: CoefficientDocument,
    options: EncodeOptions,
  ): Promise<Uint8Array>;
  validate(bytes: Uint8Array): Promise<JpegValidation>;
  capabilities(): JpegCapabilities;
}
```

These signatures are illustrative; refine them after a codec spike. Do not promise coefficient access, progressive support, or lossless behavior until verified against the chosen implementation.

The Milestone 2 prototype uses a narrow libjpeg-turbo WebAssembly C bridge
inside a dedicated worker to expose one selected 8×8 quantized coefficient
block. The bridge is read-only and bounded to 128 MiB of coefficient arrays.
It is not an encoder or a production codec commitment.

### JPEG process support

For the first implementation, explicitly choose a supported subset (recommended: baseline sequential DCT Huffman JPEG) and reject unsupported processes with a clear diagnostic. Progressive JPEG, arithmetic coding, unusual precision, and multi-scan edge cases require separate capability work.

### Coefficients and quantization

Store quantized coefficients together with component/block geometry and table assignments. If an operation changes quantization tables, define whether coefficients are retained, dequantized/requantized, or newly encoded. Never imply that editing a DQT marker alone restores discarded information.

### Entropy stream and raw bytes

Keep these operations outside the normal coefficient pipeline. A valid stream transplant must account for scan parameters, Huffman tables, bit alignment, DC predictors, restart intervals, byte stuffing, and markers. Arbitrary byte copying is not MCU copying. Treat stream experiments as potentially decoder-breaking and never overwrite the source.

## 5. Operation model

```ts
interface OperationRecord<P = unknown> {
  id: string;
  type: string;
  version: number;
  parameters: P;
  maskId?: string;
  targetComponents?: string[];
  seed?: number;
  inputRevision: number;
  status: "queued" | "previewing" | "applied" | "failed";
  diagnostics?: string[];
}
```

Operation definitions should provide:

- schema validation for parameters;
- supported representation/domain;
- compatibility checks;
- deterministic execution when a seed is supplied;
- preview and commit behavior;
- serialization and version migration;
- a clear statement of whether re-encoding is required.

Do not assume operations commute. Reordering requires recomputation of downstream results.

The current operation stack uses a version-1 serialized schema and resolves
each operation by exact type/version in `OperationRegistry`. Every stack
change replays enabled operations from the initial editable representation in
order; failed validation or execution leaves the prior document intact.
Undo/redo stores immutable document frames, while document revisions continue
to increase so preview results from earlier revisions cannot be mistaken for
current output. A supplied 32-bit seed creates a repeatable random stream.
Unknown operation versions are rejected explicitly; no migration is claimed
yet.

The only built-in operation in this milestone applies a spatial mask to the
document model. It does not modify JPEG coefficients, pixels, or source bytes.
The coefficient bridge remains read-only, so coefficient-changing operations
and re-encoding are deferred to Milestone 4.

## 6. Preview and export pipeline

1. User edits an operation or mask.
2. Application creates a preview request with document revision and operation parameters.
3. Worker computes the result.
4. Stale results are discarded if their revision no longer matches.
5. The result is encoded/decoded when exact visual preview is required.
6. Canvas renders the resulting pixel preview and overlays.
7. Export invokes a documented encoding path and validates the resulting JPEG.

The UI must distinguish:

- original preview;
- current computed preview;
- approximate/stale preview;
- exported JPEG.

Export metadata should state whether the result was re-encoded, which encoding options were used, and whether any experimental stream/byte operation was applied.

## 7. Worker protocol

Use typed request/response messages with request IDs and document revisions. Transfer large `ArrayBuffer`s where ownership transfer is safe. Support cancellation or superseding of obsolete preview jobs. Worker failures must return structured errors, not leave the UI in a permanent loading state.

## 8. Suggested source layout

```text
src/
  app/
  ui/
    canvas/
    panels/
    tools/
  application/
  document/
  jpeg/
    parser/
    model/
    codec/
    validation/
  operations/
    dct/
    quantization/
    block/
    component/
    entropy/
    raw-bytes/
  workers/
  project/
  shared/
tests/
  fixtures/
  unit/
  integration/
  golden/
```

## 9. Technology decisions

- TypeScript for application and domain contracts.
- React for the browser UI; keep framework out of domain modules.
- Vite for local development and static production builds.
- Node.js is a development/build/test tool only. The application is delivered as static browser assets; no backend is part of this foundation.
- Web Workers for parsing/codec/operations.
- WebAssembly codec adapter where it provides the required coefficient-level API.
- Canvas 2D for initial preview and overlays; profile before adopting WebGL/WebGPU.
- IndexedDB for optional local project persistence.
- Vitest for unit/integration tests; browser automation can be added for workflows.

The initial toolchain uses Node.js 20.19 or newer, pinned in `.nvmrc` for local development and selected explicitly in CI. React and React DOM are the only production dependencies at this stage. No JPEG codec has been selected or included.

A small Python/C++ prototype may be used to validate JPEG algorithms and compare codec behavior. It is a research harness, not automatically the production runtime.

## 10. Architectural decision records

Record significant choices in `docs/DECISIONS.md` or individual ADRs. At minimum decide:

1. codec and coefficient API;
2. baseline-only vs progressive support in MVP;
3. canonical coefficient representation;
4. quantization-edit semantics;
5. project asset embedding vs relinking;
6. export metadata and validation strategy;
7. boundary between safe coefficient operations and experimental stream operations.

## 11. Non-goals for the first milestone

- Full Photoshop feature parity.
- Arbitrary JPEG process support.
- Guaranteed recovery from corrupted entropy streams.
- Cloud processing or image uploads.
- GPU acceleration before profiling.
- Silent fallback from a failed coefficient operation to pixel-level editing.

## 12. Error and logging conventions

- Functions that can fail because of user input, file contents, or processing return a discriminated `Result<T, AppError>` instead of throwing expected failures.
- `AppError` contains a stable error code and a concise, user-safe message. Unexpected programming errors may still throw and are handled at the application boundary.
- Logs contain only allowlisted event names and error codes. Never log image bytes, image metadata, file names, user input, or raw stack traces.
- UI feedback uses the safe error message; diagnostic logs must not be the only user-facing explanation.
