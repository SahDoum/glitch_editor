# Architecture — JPEG Glitch Editor

**Status:** proposed baseline  
**Scope:** desktop-oriented, client-side browser application  
**Primary principle:** keep the original JPEG bytes, decoded preview, editable JPEG representation, and operation history as distinct things.

Google Tag Manager is a separate page-load integration, not part of the
JPEG pipeline. When configured, its third-party script can receive visit data
and execute container-managed tags; the application does not send image files
or edit events to it. Container configuration must also respect this boundary. See
[DEVELOPMENT.md](./DEVELOPMENT.md#publication-and-payload) for privacy and
deployment limits.

For the implemented UI, experiment-brush interaction and current limitations,
see [INTERFACE.md](./INTERFACE.md); future work and deferrals are tracked in
[ROADMAP.md](./ROADMAP.md).

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

Brush and Select author a draft spatial mask in image-pixel coordinates.
The interface uses the current draft for mask-consuming JPEG effects and no
longer exposes named masks. The underlying named-mask operation remains
available for compatibility with existing operation data. Effects embed an
immutable mask snapshot and ID in their parameters; editing the draft cannot
alter an existing operation. History can restore a snapshot as a
newly identified draft without modifying the operation or creating a history
entry. Tool-specific overlays are presentation
state: mask-authoring tools show the draft, while Coefficient Glitch and
Shuffle show the exact mask they will use. The Inspector's selected 8×8 DCT
block is visible only for Inspector. The block coordinate remains distinct
from image-pixel coordinates.

Mask input snaps to the selected component's visible 8×8 DCT-block
footprints by default, accounting for sampling factors, or to the
image-space MCU grid in MCU mode. The stored mask remains image-pixel
geometry; worker operations map it to component blocks and do not treat
snapped pixels as block or MCU coordinates. Brush overlays render each full
visible component DCT block selected by the existing mask-coverage mapping,
without circular edges or partial blocks. The DCT/MCU setting controls sample
snapping; the overlay therefore shows the component blocks an effect will
change. This is a view of the existing image-pixel mask and does not change
its stored shape or operation coverage.

The toolbar is a vertical rail to the left of the canvas and presents
contextual controls in the right column. Coefficient Glitch and block Shuffle retain an
independently selected Brush or Select canvas tool, and both selections are
shown in the toolbar. Block transfer and repeat use their own canvas gestures.
The right column contains the tool panel followed by History and the collapsible document/JPEG
information sections. History displays newer operations above older ones
without changing their bottom-to-top replay order. UI collapse and panel
selection are presentation state, not document or operation data.

Coefficient brush presets hold a component index and a single coefficient
operation. The built-in presets select component 0 with AC zeroing and
component 2 with AC scaling by two, respectively; a missing component is
reported rather than substituted. Custom brushes are validated and saved
locally under a separate storage key from multi-step recipes. Each brush's
automatic-apply toggle is saved locally per brush: when enabled, a completed
brush or rectangle mask immediately creates an ordinary undoable coefficient
operation and clears the draft mask after the operation is accepted. If
validation fails, the draft remains available for correction. The operation's
mask snapshot can be restored from history if encoding fails.
The current single-shape mask replaces the previous draft; automatic apply
does not imply an additive brush. Effect history contains an immutable mask
snapshot; restoring it replaces the draft without confirmation.

### `jpeg/`

JPEG-specific interfaces and adapters: marker parser, frame/scan metadata, coefficient access, encoding, validation, and codec capability reporting.

### `operations/`

Typed, versioned operations. Each operation declares its input domain, parameters, compatibility requirements, deterministic behavior, and execution strategy.

### `workers/`

Worker entry points and message protocol. CPU-heavy work must not block pointer interaction or canvas rendering.

### `project/`

Project serialization, schema migration, local persistence, and asset packaging.

The current `.jpglitch` version 1 format is JSON with an embedded Base64 copy
of the immutable original JPEG, its SHA-256 digest and byte length, versioned
operation records, the current draft mask, and terminal Scan Corrupt
parameters. Project input is size-bounded and parsed, decoded, and integrity
checked in a Web Worker before its source is passed through the normal JPEG
import and inspection path. Reopening validates operations against the
registered definitions and replays them from the embedded source. The project
does not serialize preview bytes or an undo/redo timeline; JPEG output is
recomputed using the recorded application and codec versions.

## 3. Core representations

Do not collapse these into one generic `image` object.

- **OriginalAsset:** exact imported bytes, filename, MIME type, cryptographic digest if available.
- **JpegStructure:** parsed markers, frame components, sampling factors, quantization/Huffman tables, scans, restart interval, coding process and parser diagnostics.
- **CoefficientDocument:** quantized coefficient arrays plus the metadata required to interpret them correctly.
- **PreviewImage:** decoded pixel buffer and the revision from which it was generated.
- **Operation:** immutable, versioned description of an edit.
- **ProjectDocument:** references the original asset and contains editable state, masks, operations, and project metadata.

The original bytes are authoritative for reset and original export. A preview is never the authoritative JPEG representation.

`OriginalAsset` keeps private byte storage and exposes copy-returning reads.
The immutable editable document tracks its monotonic revision, named
image-pixel masks, and versioned operation history separately from the source
JPEG. A spatial mask is mapped to visible component DCT blocks only in the
JPEG worker; it is not itself a DCT-block coordinate or coefficient array.
User experiment recipes are validated parameter data stored in local browser
storage, not executable code or project-document state. A multi-step recipe
is represented by one history entry and expands to its ordered coefficient
operations during document replay.

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

The libjpeg-turbo WebAssembly C bridge runs in a dedicated worker. It reads a
selected 8×8 quantized coefficient block and applies registered coefficient
edits to the codec's coefficient arrays before writing a new JPEG. The bridge
supports only the process subset below and bounds coefficient storage to
256 MiB, within the generated module's 512 MiB maximum heap. This is the
selected codec path for the current editing slice; it is
not a claim of broad JPEG process support.

The Scan Corrupt worker reuses the pinned codec to decode the corrupted output
one scanline at a time. It reports rows returned, decoder warnings, and
decompression completion separately from the browser preview result. This
diagnostic describes libjpeg-turbo's recovery only; it cannot predict how a
different decoder will render the same bytes.

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

The planned Block Transform family operates on quantized DCT coefficients in
one component of one JPEG. Copy, swap, repeat, and shuffle read from explicit
coefficient snapshots, use component block-grid coordinates, and re-encode
through the existing JPEG facade. They are typed operations, not byte or MCU
copies. Source/destination region dimensions, component bounds, coding process,
sampling geometry, and table assignments are validated before execution.

Entropy-coded scan corruption is a separate, terminal encoded-byte phase
after coefficient replay and JPEG encoding. Keep it outside the normal
coefficient worker/operation executor and run it only against a copy of the
verified encoded output. Its history entry records validated parameters and
seed; undo restores the clean encoded result, while redo deterministically
replays the corruption. Once this terminal phase exists, coefficient edits
must not be replayed after it. A corrupted result may fail preview decoding
and still remain available for export; that decode failure must not be
converted into success-shaped preview data. Preserve structural boundaries
and reject inputs whose scan boundaries cannot be validated.

The current Scan Corrupt implementation uses a dedicated worker and the
inspector's verified single-scan entropy ranges. It supports bit flips and
byte replacement, at most 256 changed bytes per stage, at most eight stacked
stages, an unsigned 32-bit seed, a normalized scan-relative range, and 100
MiB of cumulative input-byte work per replay. Input/output stay within the
existing 50 MiB JPEG limit. Changed values cannot become `0xFF`; existing
`0xFF` bytes, their following byte-stuffing bytes, restart markers, marker
segments, SOI, EOI, and file length are preserved. The worker reparses and
compares marker boundaries after every stage. Undo, redo, and an explicit
last-stage parameter update replay the entire byte-stage list from the clean
encoded result. This validates structural boundaries, not Huffman decodability
or browser-independent visual recovery; a preview failure remains an
expected result. The application only exposes the worker for bytes produced by
its current coefficient encoder and does not offer general imported-file byte
editing.
Unknown operation versions are rejected explicitly; no migration is claimed
yet.

Built-in operations include masked coefficient zero/scale/seeded randomize,
DC offset, AC inversion and frequency isolation, block duplicate/repeat and
seeded whole-block permutation within one component, and DQT table edits.
Coefficient masks stay in image-pixel coordinates until the worker maps them
to visible component blocks. Block permutation moves all 64 quantized
coefficients, including DC, and shuffles only blocks meeting the mask coverage
threshold. A DQT edit either reinterprets retained quantized coefficients or
approximately requantizes them; neither mode restores previously discarded
detail. Every operation replays in order from the immutable original and
produces a newly encoded experiment. These operations are JPEG-domain edits,
not pixel filters, MCU copies, or entropy-stream edits.

## 6. Preview and export pipeline

1. User edits an operation or mask.
2. Application creates a preview request with document revision and operation parameters.
3. Worker computes the result.
4. Stale results are discarded if their revision no longer matches.
5. Coefficient operations are re-encoded as a new JPEG and decoded for preview.
6. Canvas renders the resulting pixel preview and overlays.
7. Export retains the encoded experiment. Independent validation may report
   whether it is standards-compliant and decodable, but a failed browser
   preview does not discard the encoded bytes.

The UI must distinguish:

- original preview;
- current computed preview;
- approximate/stale preview;
- exported JPEG.

The current coefficient path supports only 8-bit baseline sequential Huffman
JPEG with one interleaved scan and grayscale or three-component frames. It
preserves dimensions and component geometry while writing a new entropy-coded
scan. It copies saved APP/COM marker segments except APP0 and APP14; APP0 may
be regenerated by the codec. Metadata preservation is not guaranteed. The UI
labels the result as an encoded experiment, distinguishes preview decode
failure from encode failure, and keeps export available when only preview
decoding fails. Independent conformance checks are useful evidence, not the
primary acceptance criterion for a visual glitch experiment. Entropy-stream
and raw-byte operations remain separately identified.

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

The initial toolchain uses Node.js 20.19 or newer, pinned in `.nvmrc` for local development and selected explicitly in CI. React and React DOM are production JavaScript dependencies. The libjpeg-turbo static WebAssembly library is a build-time dependency; the generated JS/WASM bridge is shipped as a lazy-loaded browser asset.

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
