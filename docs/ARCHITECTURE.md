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

Canvas, panels, tool controls, dialogs, keyboard shortcuts, overlays, and the
catalog rendering. UI must not parse JPEG markers or mutate coefficient arrays
directly.

### `features/canvas-tools/`

The canvas-tool registry pairs `CanvasInteraction` constructors with their
toolbar views and optional controls. Effects declare allowed tool IDs. The
toolbar and keyboard shortcuts use the same activation path. The editor
creates one instance of each registered controller per workspace.

The UI normalizes pointer input to original JPEG frame coordinates and binds
one captured pointer to the gesture from the active interaction. All, Brush,
Select, pan and the effect adapter implement the same contract. It exposes
activation, hints, overlays, keyboard input, and hover where the interaction
supports them. Select owns its keyboard anchor, and Brush owns the sampled
points of the current stroke. A successful editing capture focuses the canvas
without scrolling. Cancellation discards the gesture draft and releases
capture. `ImageOverlays` renders the draft and committed outlines. The
editor commits a completed mask once. A per-document preference for each
effect and tool allows one operation after a completed stroke or rectangle.
The mask is cleared after successful encoding. Choose Whole photo or use
Control/Command+A on the focused canvas to select the full frame.

Block Transfer and Repeat supply phase-specific hints through their existing
gesture controllers. Transfer applies at the end of a valid destination drag.
Repeat uses the operation validator to mark an invalid destination and keeps
its explicit Apply button.

### `features/effects/`

Every effect is one entry in a single registry (`effects/registry.ts`):
`effectId → { controller, view }`. The effect menu is a separate registry
(`EFFECT_MENU`) that only lists effect IDs by category; it carries no effect
behavior.

- The **View** owns everything presented to the user: label, description,
  icon, the settings panel, the canvas-toolbar configuration, the top-bar
  actions and their shortcuts, default settings, the settings store, and how
  its operations appear in History (`operation.describe`).
- The **Controller** holds a pointer to its View and owns behavior only:
  `buildOperation` (the single source of Preview and Apply parameters) and
  `apply`, which validates parameters and dispatches into the existing
  document operations. Gesture effects add a `gestures` controller (pointer
  begin/move/end/cancel and an overlay description).
- Each concrete JPEG effect controller names its `OperationController` and
  constructs its own operation parameters. Coefficient effects share the
  codec operation, not a View-selected mode: fixed modes and preset values
  belong to the controller, while editable bands, strength, seed, component
  and mask are mapped explicitly. Engraving accepts only its two directional
  modes; Pixelate fixes its entire coefficient preset. Shared validation and
  history machinery do not select an effect's behavior.
- Transfer assembles its clipped source and destination DCT-block coordinates
  in its own controller, shared by its gestures and `buildOperation`.
  Quantization records the chosen DQT values and reinterpret/requantize
  semantics explicitly. Scan Corrupt maps its byte-experiment parameters
  separately and never enters the coefficient worker's operation registry.
- `App` is generic: it looks up the active effect by ID and calls the View and
  Controller contracts. There are no per-effect conditionals, and nothing in
  `App`, `ui/`, or the workspace reducer names an effect.
- Scan Corrupt is a different kind of controller. It implements
  `execute_corrupt` (clean encoded bytes plus typed stages in, corrupted bytes
  and reports out) and has no `apply`. The type guards
  `isJpegOperationController` / `isScanCorruptionController` let each worker
  boundary accept only its own kind, so entropy-stream work can never enter
  coefficient history. Its history, workers, and original bytes stay separate.

Block Transfer and Block Repeat are `gesture` effects. They select and drag
through the same hierarchy as the mask tools: the pointer is routed to the
active effect's gesture controller instead of Brush/Select. Their top-bar
"New source" action (shortcut R) resets the source region; it is disabled
while no source is chosen, and changing the target component also discards the
source because block coordinates are per component.

Legacy persisted keys are preserved through the optional `storageKey` on a
View (Posterization keeps `dc-steps`, Coefficient Scale keeps `chroma-scale`).
History entries record operation kinds, not effect IDs, so Pixelate and Zero
(and Engraving / Vertical Engraving) produce identical operations. Their
History rows therefore show the family title instead of guessing a View.
Recording the effect ID in new operations would be a project-format change and
needs a separate decision.

Mask-authoring tools (All, Brush, Select) can change without replacing the
selected effect panel. Hand, Inspector, and Info no longer exist; Original
asset and JPEG structure details are not part of the tool panels. The
quantization View keys its editor by the original asset digest so a new JPEG
resets its local draft. Handlers reach panels through a stable `EditorBridge`
that always forwards to the latest application handlers.

The right-panel JPEG component selector is shared through
`ui/component-choice-group.tsx`; the DCT frequency matrix is a separate
reusable component in `ui/dct-basis-matrix.tsx`.

### `application/`

Coordinates import, document lifecycle, selection, operation dispatch, preview requests, export, and error presentation.

### `document/`

Owns immutable source assets, document metadata, current editable representation, masks/selections, operation stack, and revision identifiers.

Whole photo uses a full-frame mask. Brush and Rectangle author a draft
spatial mask in image-pixel coordinates. Leaving Whole photo starts an
empty local area, and temporarily switching to a gesture or panel effect
keeps the local area and tool. Opening a project restores the tool from
the geometry of the saved mask.
The interface uses the current draft for mask-consuming JPEG effects and no
longer exposes named masks. The underlying named-mask operation remains
available for compatibility with existing operation data. Effects embed an
immutable mask snapshot and ID in their parameters; editing the draft cannot
alter an existing operation. History can restore a snapshot as a
newly identified draft without modifying the operation or creating a history
entry. Tool-specific overlays are presentation
state: mask-authoring tools show the draft, while Coefficient Glitch and
Shuffle show the exact mask they will use. The block coordinate remains distinct from image-pixel coordinates.

Mask input snaps to the active Coefficient Glitch component's visible 8×8
DCT-block footprints by default, accounting for sampling factors, or to the
image-space MCU grid in MCU mode. Brush and Select do not own or store a
component choice; the effect's target selector stays in the JPEG effect panel,
and DCT snapping follows that target. The stored mask remains image-pixel
geometry; worker operations map it to component blocks and do not treat
snapped pixels as block or MCU coordinates. Brush overlays render each full
visible component DCT block selected by the existing mask-coverage mapping,
without circular edges or partial blocks. The DCT/MCU setting controls sample
snapping; the overlay therefore shows the component blocks an effect will
change. This is a view of the existing image-pixel mask and does not change
its stored shape or operation coverage.

The workspace has an Effects catalog, canvas, and contextual effect
settings. History opens in the settings column without discarding the form.
Newer operations appear above older ones while replay still runs in stack
order. File commands share one open path, including dropped files. A saved
project snapshot tracks operations, the working area, and damage stages.
Import prepares the replacement and replays any project operations before
replacing the current document.

Coefficient effect settings are validated and saved separately per effect in
browser `localStorage`; they are not serialized into `.jpglitch` projects.
Applied operations retain their own immutable parameter snapshots in History.
Other UI settings are not guaranteed to persist across reloads.

Coefficient effects use single-operation presets without a component index.
The effect's current component selection is applied when the operation is
committed, and the resulting JPEG operation records that component index.
Every supported coefficient mode is available through the Effects catalog;
Engraving selects horizontal or vertical mode in its settings while retaining
the existing typed operation modes and per-effect settings storage.
Custom User brush creation and selection are not exposed. Previously stored
custom-brush data is left untouched in browser storage but is not loaded by the
interface. Automatic application starts disabled on each open. When enabled,
a completed Brush or Rectangle gesture requests one undoable operation.
The mask remains available if validation or encoding fails.
The current single-shape mask replaces the previous draft; automatic apply
does not imply an additive mask. Effect history contains an immutable mask
snapshot; restoring it replaces the draft without confirmation.

### `jpeg/`

JPEG-specific interfaces and adapters: marker parser, frame/scan metadata, coefficient access, encoding, validation, and codec capability reporting.

### `operations/`

Typed, versioned operations. Each operation declares its input domain, parameters, compatibility requirements, deterministic behavior, and execution strategy.

### `workers/`

Worker entry points and message protocol. CPU-heavy work must not block pointer interaction or canvas rendering.

### `project/`

Project serialization, schema migration, local persistence, and asset packaging.

The current `.jpglitch` version 2 format is JSON with an embedded Base64 copy
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

Browser previews honor EXIF orientation. Overlay geometry and pointer positions
are transformed between the oriented preview and the unrotated JPEG frame;
masks and coefficient operations remain in frame coordinates. EXIF orientation
is also expected on re-encoded previews. Invalid or ambiguous EXIF orientation
metadata is rejected rather than risking edits in the wrong location.

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

Before encoding, the JPEG facade sends typed, structured-cloneable operations
to the coefficient worker. Each effect references its operation controller;
the controller's `kind` identifies the recorded operation and the worker
registry entry. The worker validates operations and work limits, then resolves
each `kind` to that controller in order. The controller maps image-pixel masks
to component DCT-block masks and owns the WASM call and temporary-memory
cleanup. Functions and controller instances do not cross `postMessage`.

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

When there are no coefficient or DQT operations, the first Scan Corrupt stage
encodes the original coefficients as baseline on demand. Undo restores that
clean encoding, and projects with only scan stages replay the same preparation.

The current Scan Corrupt implementation uses a dedicated worker and the
inspector's verified single-scan entropy ranges. It explicitly rejects
Progressive JPEG (multi-scan) input; progressive scan corruption is future work. It supports bit flips and
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

Built-in operations include masked coefficient zero/scale/seeded randomize.
Pixelate is a fixed `zero` preset that targets all AC coefficients; the
separate Zero effect exposes DC and AC frequency selection.
DC offset, DC coefficient step rounding, AC inversion, frequency isolation,
AC low-pass, ringing boost and directional engraving, block duplicate/repeat and
seeded whole-block permutation within one component, and DQT table edits.
Coefficient masks stay in image-pixel coordinates until the worker maps them
to visible component blocks. Block permutation moves all 64 quantized
coefficients, including DC, and shuffles only blocks meeting the mask coverage
threshold. A DQT edit either reinterprets retained quantized coefficients or
approximately requantizes them; neither mode restores previously discarded
detail. Every operation replays in order from the immutable original and
produces a newly encoded experiment. These operations are JPEG-domain edits,
not pixel filters, MCU copies, or entropy-stream edits.

DC steps rounds selected quantized DC coefficients to signed multiples of an
integer step from 1 to 512, with half steps rounded away from zero and
out-of-range multiples limited to the largest representable multiple. AC and
other components remain unchanged. The step is in quantized coefficient
units, not decoded pixel values; DQT assignments affect the visual result.
Older versions do not recognize this new serialized operation mode.

AC low-pass preserves DC and quantized AC coefficients with u+v at or below
an integer cutoff from 1 to 14 and zeros the remaining AC coefficients in
masked blocks of one component. It does not detect edges or promise visible
ringing. Cutoff 14 changes no coefficients. Older versions do not recognize
this serialized operation mode.

Ringing boost retains DC and AC below u+v 3, scales AC at u+v 3 by a
factor from 1 to 8, and zeros higher AC in selected blocks. Scaling rounds
half away from zero and clamps AC to ±1023. This is a separate serialized
mode: existing AC low-pass operations retain their original semantics. It
does not identify edges or guarantee ringing.

Directional engraving retains DC, scales the selected axis of AC by a factor
of 1–8 and zeros other AC in masked blocks of one component. Horizontal
preserves u=0 (v>0); vertical preserves v=0 (u>0). Scaling rounds half
away from zero and clamps AC to ±1023. Directions are distinct serialized
modes, so replay records the choice. This operation neither removes chroma
automatically nor guarantees an engraving-like image. Older versions do not
recognize the new modes.

Local block shift snapshots same-component source blocks and copies them into
masked destinations at a signed block-grid offset. Mask coverage uses the
same 50% threshold as block permutation. Out-of-bounds sources leave their
destinations unchanged. Each stage is bounded to 262,144 destinations, is
versioned in history/project data, and re-encodes through the codec facade.
It does not imply fractional-sample chroma translation or MCU manipulation.

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

A draft preview re-encodes a temporary JPEG through the operation controller.
Coefficient effects request previews when the draft changes. Mask-based block
effects offer a manual preview. Changing a draft replaces its visible preview
with the last result or original and cancels the obsolete worker request.
A file opening starts a new session, even when the source bytes match.
Apply commits one operation after encoding succeeds. A matching draft can
supply its encoded bytes directly for Apply and download. Undo and Redo
recompute the committed stack. Scan Corrupt renders its own terminal stages.

The UI must distinguish:

- original preview;
- current computed preview;
- approximate/stale preview;
- exported JPEG.

The current coefficient path supports 8-bit Huffman JPEG in two processes:
baseline sequential (one interleaved scan) and progressive (SOF2, any number of
scans), for grayscale or three-component frames. The libjpeg-turbo bridge
reads progressive input with `jpeg_read_coefficients()`, which consumes every
scan and returns the complete quantized coefficient arrays, so operations see
the same `CoefficientDocument` data for both processes. The bridge rejects a
progressive file if libjpeg reports any warning while assembling coefficients
(truncated or damaged scan data), rather than treating partial coefficients as
complete. Arithmetic coding, non-8-bit precision, extended/lossless/hierarchical
processes and non-sequential multi-scan baseline files stay rejected.

Output mode is an independent `EncodeOptions { mode: "baseline" | "progressive" }`
passed to `encodeJpegCoefficients()` and the worker `encode` request, which
always replays operations from the original bytes. `coefficient_encode(1)` calls
`jpeg_simple_progression()` after `jpeg_copy_critical_parameters()` and before
`jpeg_write_coefficients()`; no custom scan scripts are supported, and there is
no RGB round trip. Coefficients, geometry, and quantization tables are identical
for both output modes, so source process and output mode combine freely. Normal
preview/clean encoding stays baseline; the Save dialog re-encodes progressive
on demand. Scan Corrupt always works on the baseline clean encoding. It writes
a new entropy-coded scan. It copies saved APP/COM marker segments except APP0 and APP14; APP0 may
be regenerated by the codec. Metadata preservation is not guaranteed. The UI
labels the result as an encoded experiment, distinguishes preview decode
failure from encode failure, and keeps export available when only preview
decoding fails. Independent conformance checks are useful evidence, not the
primary acceptance criterion for a visual glitch experiment. Entropy-stream
and raw-byte operations remain separately identified.

## 7. Worker protocol

Use typed request/response messages with request IDs and document revisions. Transfer large `ArrayBuffer`s where ownership transfer is safe. Support cancellation or superseding of obsolete preview jobs. Worker failures must return structured errors, not leave the UI in a permanent loading state.

JPEG operations cross the worker boundary as structured-cloneable data;
executable functions and controller instances are never posted. The worker
resolves each operation kind through `jpeg/codec-controllers/registry.ts`.
The shared operation controller owns validation, work sizing, codec memory
preparation, mask mapping, and its corresponding WASM call. Effect controllers
reference it directly and use `apply` to record operations in history.
Project schema version 2 records the operation kind as its type; version 1
projects are rejected rather than migrated.

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
