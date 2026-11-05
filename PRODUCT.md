# JPEG Glitch Editor --- Project Specification

**Status:** Product and technical specification (MVP + roadmap)\
**Platform:** Browser application\
**Working title:** JPEG Glitch Editor

## 1. Product vision

Build a browser-based visual editor for experimental image-making in
which the primary editing operations act on the **JPEG representation
itself**, not merely on decoded RGB pixels.

The interaction model should feel familiar to users of Paint, Photoshop,
or other raster editors:

- open or drag-and-drop a JPEG;
- see it on a central canvas;
- choose tools from a toolbar;
- paint, select, transform, and apply effects;
- adjust tool parameters;
- work with layers or an ordered stack of operations;
- undo and redo;
- compare the result with the original;
- export the edited image.

The defining difference is that the tools operate on JPEG structures and
coding data: quantization tables, DCT coefficients, 8×8 blocks, MCU
regions, JPEG scans, entropy-coded data, and (in an advanced mode) raw
file bytes.

This is an experimental image editor, not a general-purpose replacement
for Photoshop. It should prioritize controllable, reproducible JPEG
glitch techniques over a large collection of conventional filters.
Its primary success criterion is whether photographers can explore and
compare visual consequences of changing JPEG coding data. A standards-valid,
universally decodable JPEG is one useful outcome, not a prerequisite for
every experiment.

## 2. Product principles

1.  **JPEG-native editing.** Keep the original JPEG and its encoded
    representation available throughout the session. Do not silently
    turn every operation into an RGB filter.
2.  **Visible, understandable operations.** Each tool must explain which
    JPEG layer it changes and what the likely visual consequence is.
3.  **Non-destructive by default.** Store edits as parameters and
    operations. Preserve the original file unchanged.
4.  **Reproducibility.** Random operations must accept and display a
    seed.
5.  **Immediate feedback.** Provide preview updates while adjusting
    parameters, with debouncing or progressive rendering for expensive
    operations.
6.  **Honest technical modes.** Clearly distinguish coefficient-domain
    edits that are re-encoded from edits to the original entropy-coded
    stream or raw bytes.
7.  **Graceful failure.** A malformed stream may fail to decode. Never
    silently discard the original or overwrite it.
8.  **Browser-first privacy.** Process files locally in the browser
    where feasible. Do not upload user images to a server by default.
9.  **Experiment before conformance.** Show the resulting JPEG when a
    decoder can render it, but retain an encoded experiment for export
    when preview decoding fails. Report the failure as an observed
    outcome, not as proof that the visual experiment has no value.

## 3. Target users and use cases

### Primary users

- photographers and visual artists experimenting with digital image
  degradation;
- glitch-art practitioners and databending artists;
- developers and researchers exploring JPEG internals.

### Core use cases

- apply a controlled JPEG glitch to a photograph;
- paint an effect into a selected region;
- transplant JPEG coefficient structures from one image to another;
- explore how individual JPEG parameters affect the decoded image;
- combine several operations and reorder or disable them;
- compare multiple parameter variations;
- export a result and reproduce it later.

## 4. Scope

### MVP

The first usable version should support:

- JPEG import through file picker and drag-and-drop;
- canvas display, zoom, pan, fit-to-screen;
- original-image preservation;
- JPEG metadata and coding-parameter inspection;
- block-level DCT coefficient editing;
- quantization-table editing and re-encoding;
- region selection and brush masks;
- block/MCU-aware operations;
- operation history with undo/redo;
- deterministic random seed;
- before/after preview;
- JPEG export, with clear indication that export re-encodes the image.

### Later releases

- two-image workflow and DCT transplant;
- AC-only and DC-only transplant;
- progressive JPEG scan inspection and experiments;
- controlled entropy-stream manipulation;
- raw byte editor;
- presets and parameter variation browser;
- save/load project files;
- optional desktop wrapper.

### Explicitly out of scope for MVP

- general vector editing;
- full Photoshop-compatible layer model;
- RAW camera processing;
- video datamoshing;
- arbitrary support for every JPEG-family extension;
- guarantee that malformed JPEGs render identically in all decoders.

## 5. JPEG concepts the application must model

The implementation must understand at least the following concepts.

### 5.1 File structure

A JPEG file is a sequence of marker segments and coded data. Relevant
markers include:

- `SOI` (`FF D8`) --- start of image;
- `APPn` --- application metadata, including EXIF in common files;
- `DQT` --- quantization tables;
- `SOF` --- frame parameters, dimensions, components and sampling;
- `DHT` --- Huffman tables;
- `SOS` --- start of scan;
- `DRI` --- restart interval;
- `RSTn` --- restart markers;
- `EOI` (`FF D9`) --- end of image.

The parser must not assume that every JPEG has one simple scan or that
all bytes after SOS are ordinary marker segments. Entropy-coded scan
data has its own byte-stuffing and marker rules.

### 5.2 DCT blocks

In common DCT-based JPEG modes, image components are represented as 8×8
blocks of quantized DCT coefficients.

Each block contains:

- one DC coefficient, representing the block's average level relative
  to the component's prediction context;
- 63 AC coefficients, representing spatial-frequency information.

The editor should expose coefficient coordinates (`u`, `v`) and a
frequency visualization. It must not describe AC coefficients as literal
pixel details; they represent spatial frequencies.

### 5.3 Quantization

A quantization table contains 64 values. Each DCT coefficient is divided
by its corresponding quantization value and rounded during encoding. The
quantized coefficients are then entropy-coded.

Editing quantization tables therefore changes the relationship between
DCT values and their quantized representation. To apply a changed table
to an existing image, the application must define whether it is: -
requantizing from retained/dequantized coefficient information; or -
changing tables for a new encoding operation.

It must not imply that changing a DQT marker alone magically restores or
modifies information already lost in an existing JPEG.

### 5.4 Entropy coding

For baseline sequential Huffman JPEG, quantized coefficients are encoded
using DC differential coding, run-length coding for AC coefficients, and
Huffman codes. The entropy stream is bit-oriented; Huffman codes are
variable length.

A raw byte range copied from one JPEG into another is not generally a
valid block or MCU transplant. Decoding depends on coding tables,
component scan configuration, bit alignment, DC predictor state, restart
intervals, and marker/byte-stuffing rules.

### 5.5 MCU and sampling

An MCU (Minimum Coded Unit) groups component blocks according to
sampling factors. For example, common 4:2:0 sampling uses a 16×16 luma
region with associated chroma blocks. MCU geometry is not always 1:1
with an 8×8 block.

The UI must distinguish: - pixel coordinates; - 8×8 DCT block
coordinates; - MCU coordinates; - byte/bit offsets in the encoded file.

## 6. User interface

### 6.1 Main layout

A desktop-oriented responsive workspace:

- **Top bar:** file name, open/import, save project, export, undo,
  redo, compare.
- **Left toolbar:** pointer, selection, brush/mask, block tools,
  glitch tools.
- **Center canvas:** image preview with zoom and pan.
- **Right inspector:** parameters for the selected tool or selected
  JPEG structure.
- **Bottom panel:** operation/layer stack, history, optional
  coefficient/stream inspector.

On narrow screens, side panels may collapse into drawers. The
application is primarily designed for desktop browsers.

### 6.2 Canvas

Required interactions:

- zoom in/out and fit image;
- pan;
- pixel-accurate cursor coordinates;
- optional overlay for 8×8 block grid;
- optional MCU grid;
- selection rectangle and freehand mask;
- show/hide original;
- split-view or difference preview;
- indicate when the displayed preview is approximate or stale.

The canvas displays a decoded preview. The source JPEG data remains a
separate authoritative document model.

### 6.3 Tool inspector

Every tool exposes:

- tool name and short explanation;
- target domain (DCT, quantization, MCU, entropy stream, raw bytes);
- parameters with sensible ranges;
- affected component(s);
- blend/application mode where meaningful;
- deterministic seed for random behavior;
- Apply/preview controls where computation is expensive;
- Reset tool settings.

### 6.4 History and operation stack

The editor needs both a user-facing operation stack and undo/redo.

Each operation record should contain:

- unique ID;
- operation type and version;
- parameters;
- affected region/mask;
- target component(s);
- random seed, if any;
- input document revision;
- status (previewing, applied, failed);
- optional execution diagnostics.

Users can:

- undo and redo;
- toggle an operation on/off;
- reorder operations when the operation type supports it;
- duplicate an operation;
- edit its parameters;
- delete an operation;
- revert to the original.

Reordering may change results. The UI must recompute downstream
operations and must not promise that all operations commute.

## 7. Tool specification

Tools are grouped by the JPEG representation they manipulate. All
region-based tools should support a mask or selection where technically
meaningful.

### 7.1 Navigation and selection

**Pointer / Hand** - select and move around the canvas; - pan and zoom.

**Rectangular selection** - select a pixel-space region; - show its
intersecting DCT blocks and MCUs; - snap-to-block and snap-to-MCU
options.

**Brush mask** - paint an editable mask; - brush size, hardness,
opacity; - add/subtract mask modes; - optional block-aware and MCU-aware
snapping.

The mask is a spatial control surface. The engine must map it to the
appropriate JPEG units for each operation.

### 7.2 DCT tools

**DCT Brush** - modify quantized DCT coefficients in blocks intersecting
the brush mask; - controls: radius, strength, falloff, component,
frequency range, operation mode, seed; - modes: add, multiply, clamp,
randomize, zero, mirror/sign change, copy from another region; - provide
a coefficient heatmap and optional frequency selector.

**Frequency Select** - select a range of DCT frequencies; - low / middle
/ high bands are presets, not fixed universal definitions; - allow
custom `u,v` ranges or masks over the 8×8 coefficient grid.

**DC / AC tools** - DC operation: modify DC coefficients, with explicit
warning that DC prediction and coefficient interpretation are
component-specific; - AC operation: modify selected AC coefficients
while leaving DC coefficients untouched.

The initial glitch lab exposes zero, scale, and seeded randomize modes for
selected coefficients, plus a signed DC offset. Coefficient ranges are
bounded to the baseline representation supported by the current encoder.
Randomize stores an unsigned 32-bit seed so replay is reproducible.

**Block Transplant** - copy quantized coefficient blocks from a source
region into a target region; - initially require compatible component
layout and block geometry; - define policy for quantization-table
mismatch (reject, convert via dequantize/requantize, or explicitly
warn); - support source and target alignment; - show a preview before
committing.

**DCT smear / repeat** - copy or repeat coefficient blocks along a
direction; - controls: direction, distance, repetition, falloff, source
offset, seed.

### 7.3 Quantization tools

**Quantization Matrix Editor** - display the 8×8 table as an editable
grid and heatmap; - support direct numeric entry; - paint values into
cells; - scale selected cells; - invert/transpose/mirror patterns where
mathematically defined; - generate gradients, stripes, radial patterns
and seeded random patterns; - select luminance/chrominance tables; -
show current table and proposed table side by side.

**Quantization operations** - global scaling; - frequency-band
scaling; - per-cell edits; - procedural patterns; - preview by
encoding/decoding through a controlled pipeline.

The UI must distinguish table editing from re-quantizing existing
coefficients. The engine must document its chosen behavior and preserve
the original coefficients so edits can be revised.

The initial editor offers two explicit behaviors: reinterpret the retained
quantized coefficients using the edited DQT, or approximately requantize
using `round(oldCoefficient × oldQuantizer / newQuantizer)`. Neither mode
restores information discarded before import. Flat, stripe, radial, and
seeded-random matrix patterns are available in natural 8×8 coefficient
order.

### 7.4 MCU and block tools

**Block Corrupt** - affect selected 8×8 blocks; - operations: zero
coefficients, randomize selected bands, replace with neighboring block,
duplicate, swap, shift coefficient positions (within valid coefficient
representation).

**MCU Corrupt** - affect MCUs using the actual sampling configuration of
the source; - operations: duplicate, swap, replace from another MCU,
repeat, omit/reconstruct where supported; - display MCU boundaries.

**Block/MCU displacement** - remap coefficient blocks or MCUs
spatially; - define edge handling and component alignment; - do not
implement by moving arbitrary byte ranges.

The first lab duplicates one quantized DCT block repeatedly within the
same component. Source and every destination must fit that component's
visible block grid. This does not copy an MCU or entropy-coded bytes.

### 7.5 Component tools

Expose component-aware operations for: - Y (luma); - Cb; - Cr.

Possible operations: - corrupt one component; - transplant one
component; - shift or repeat component blocks; - alter chroma sampling
only through a valid re-encoding pipeline.

The UI should explain that chroma components may have lower spatial
resolution due to subsampling.

### 7.6 Entropy-stream tools (advanced mode)

These tools operate on encoded scan data, not decoded coefficients.

**Stream Range Inspector** - inspect scan boundaries and byte offsets; -
display marker and restart-marker positions; - show byte-stuffed `FF 00`
sequences distinctly; - expose bit offsets only when the parser can
determine them reliably.

**Stream Corrupt** - flip bits or alter byte ranges within a scan; -
controls: byte/bit range, probability, burst length, seed; - preserve a
copy of the original stream; - show decoder errors and recovery
behavior.

**Stream Transplant** - select a source JPEG and a source scan range; -
select a target JPEG and target insertion/replacement point; - offer
strict compatibility checks; - clearly label this as experimental and
potentially invalidating the file.

Do not present arbitrary byte copying as MCU copying. A safe
implementation must either: 1. transplant decoded coefficient blocks and
re-encode; or 2. implement a bitstream-aware transplant that accounts
for Huffman tables, scan parameters, bit alignment, DC predictors,
restart intervals, byte stuffing and markers.

For the first release, raw stream tools may be omitted or restricted to
a sandbox preview that never overwrites the source.

### 7.7 Raw byte tools (advanced mode)

- hex view of file bytes;
- search for JPEG markers;
- select byte ranges;
- flip, replace, insert, delete, repeat or shuffle bytes;
- seed-controlled random corruption;
- protect SOI/EOI and structural segments by default;
- allow expert override with an explicit warning;
- maintain exact original bytes for recovery.

Raw-byte operations should be treated as experimental. The application
must expect decoder failure and retain the ability to reset to the
original.

### 7.8 Re-encoding and degradation tools

- export at selected JPEG quality;
- select chroma subsampling where supported;
- repeat encode/decode generations;
- control quantization tables;
- optionally compare each generation;
- label this family as re-encoding effects, not direct bitstream
  corruption.

## 8. Two-image workflow: transplant

A later milestone adds a second source image.

Workflow: 1. Open a target JPEG. 2. Add a source JPEG. 3. Choose a
source region on the source canvas. 4. Choose a target region on the
target canvas. 5. Choose transplant domain: DCT blocks, MCU, DC, AC,
component, or raw stream. 6. Run compatibility checks. 7. Preview the
result. 8. Commit as a reversible operation.

Compatibility checks include: - image component count and identifiers; -
sampling factors; - block dimensions and alignment; - quantization table
assignment and values; - scan organization and coding mode; - precision
and supported JPEG process.

If conversion is possible, show the conversion path and its
consequences. If not, reject the operation with a useful explanation.

## 9. Technical architecture

### 9.1 Recommended architecture

A client-side web application with a clear separation between UI,
document model, JPEG parser/codec, and editing engine.

Suggested stack: - TypeScript; - React or another component framework; -
Web Workers for CPU-heavy work; - WebAssembly for JPEG parsing,
coefficient access and encoding; - Canvas 2D for the initial preview and
overlays; - WebGL or WebGPU only if profiling demonstrates a need; -
IndexedDB for optional local project persistence.

### 9.2 Processing pipeline

```text
JPEG file
   |
   v
File parser / marker scanner
   |
   +--> Metadata and frame model
   |
   +--> Scan / entropy data model
   |
   +--> JPEG decoder
            |
            +--> Quantized DCT coefficient arrays
            |
            +--> Decoded preview
   |
   v
Operation stack
   |
   +--> DCT operations
   +--> Quantization operations
   +--> Block / MCU operations
   +--> Component operations
   +--> Experimental stream / byte operations
   |
   v
JPEG encoder or controlled stream writer
   |
   v
Preview decoder
   |
   v
Canvas
   |
   v
Export JPEG
```

The parser, coefficient engine and encoder should be isolated behind
stable interfaces. UI components must not directly manipulate binary
offsets or codec internals.

### 9.3 JPEG engine

Evaluate: - `libjpeg-turbo` compiled to WebAssembly; - `mozjpeg` /
compatible encoder options; - a custom parser for marker and scan
inspection; - a coefficient-access layer exposed to TypeScript.

`jpegio` is useful for Python prototyping but should not be assumed to
be a browser runtime dependency.

The chosen codec must be tested for: - baseline sequential Huffman
JPEG; - progressive JPEG; - grayscale; - common 4:2:0 and 4:2:2
sampling; - EXIF orientation; - embedded ICC profiles; - restart
markers; - malformed and truncated inputs.

Support for arithmetic-coded JPEG, lossless JPEG, 12-bit JPEG and
uncommon processes can be deferred, but unsupported files must be
identified rather than silently misinterpreted.

### 9.4 Document model

Represent the open document separately from its current preview.

Suggested conceptual model:

```ts
type JpegDocument = {
  id: string;
  originalBytes: ArrayBuffer;
  fileName: string;
  parsedInfo: JpegInfo;
  coefficientData?: CoefficientDocument;
  operations: EditOperation[];
  activeOperationIds: string[];
  revision: number;
};

type EditOperation = {
  id: string;
  type: string;
  version: number;
  enabled: boolean;
  parameters: Record<string, unknown>;
  mask?: SpatialMask;
  seed?: number;
  inputRevision: number;
};

type JpegInfo = {
  width: number;
  height: number;
  precision: number;
  process: string;
  components: JpegComponentInfo[];
  quantizationTables: QuantizationTableInfo[];
  huffmanTables: HuffmanTableInfo[];
  scans: ScanInfo[];
  restartInterval?: number;
};
```

These are conceptual TypeScript interfaces; implementation details may
differ.

### 9.5 Operation execution

- Operations should be deterministic for a given input revision and
  seed.
- Cache intermediate coefficient states where memory permits.
- Invalidate downstream cache entries when an earlier operation
  changes.
- Use immutable snapshots or reversible deltas for reliable undo/redo.
- Avoid copying large coefficient arrays for every small UI
  interaction.
- Separate fast interactive preview from final-quality export.
- Use worker messages with progress and cancellation support.

### 9.6 Preview strategy

The editor may use several preview paths:

1.  **Coefficient-domain preview:** apply an operation to coefficient
    data, encode or decode a preview.
2.  **Approximate preview:** use a faster visual approximation while the
    exact JPEG result is being computed. Label it clearly.
3.  **Stream-corruption preview:** attempt decoding a temporary
    corrupted byte stream using a recoverable decoder. Failure is an
    expected result, not a crash.

Never show an RGB-only approximation as if it were the exact result of a
raw JPEG stream edit.

## 10. Export and project persistence

### JPEG export

Offer: - export edited JPEG; - choose encoder quality or quantization
settings where supported; - preserve or explicitly handle EXIF and ICC
metadata; - show whether the export is a fresh encoding or a modified
original bitstream; - warn when export changes coding mode or
metadata; - never overwrite the imported file implicitly.

### Project file

A project file should store: - source image reference or embedded
original bytes (user choice); - operation stack; - masks and
selections; - tool settings; - random seeds; - codec and application
version; - optional preview thumbnail.

A project should be reopenable with the same operations. If codec
behavior changes between versions, the application should identify the
version and warn that exact output may differ.

## 11. Performance and memory

- Parse and decode in Web Workers.
- Avoid blocking the UI thread.
- Use transferable buffers where practical.
- Generate lower-resolution previews for large images.
- Debounce slider and brush updates.
- Provide cancellation for expensive operations.
- Display progress for full-image re-encoding.
- Establish a documented maximum supported image size for the first
  release.
- Handle browser memory pressure and release temporary buffers.

The Milestone 1 inspector accepts JPEG files up to 50 MiB, frame dimensions
up to 40 megapixels, and at most 10,000 markers. The marker parser runs in a
cancellable Web Worker; oversized inputs are rejected before preview decoding.

## 12. Error handling and safety

- Keep original bytes immutable.
- Validate marker lengths and segment boundaries.
- Detect truncated files and malformed segments.
- Guard against oversized dimensions and decompression/memory
  exhaustion.
- Never trust declared image dimensions without bounds checks.
- Isolate parser and decoder failures from the UI.
- Provide a reset-to-original action that always remains available.
- Explain when a result is decoder-dependent.
- Do not claim that a corrupted JPEG is standards-compliant.

## 13. Accessibility and usability

- Keyboard shortcuts for undo/redo, zoom, hand tool and export;
- tooltips and concise explanations of JPEG terminology;
- numeric parameter entry in addition to sliders;
- visible focus states;
- high-contrast overlays for block and selection boundaries;
- avoid relying on color alone to distinguish components or states.

## 14. MVP acceptance criteria

The MVP is complete when a user can:

1.  Open a JPEG by file picker or drag-and-drop.
2.  See image dimensions, JPEG process, components, sampling factors and
    quantization tables.
3.  View an 8×8 block grid and inspect a selected block's DCT
    coefficients.
4.  Paint a mask and apply at least one DCT operation to affected
    blocks.
5.  Run zero/scale/randomize, DC offset, AC manipulation, block repeat,
    and DQT pattern experiments with undo/redo.
6.  Distinguish DQT reinterpretation from coefficient requantization and
    understand that neither recovers discarded detail.
7.  Toggle and edit operations in the history/stack.
8.  Reproduce seeded random edits.
9.  Export an encoded experiment even when the browser cannot preview
    decode it, with that limitation clearly reported.
10. Recover the original image at any time.
11. Use the application without uploading the image to a remote server.

## 15. Suggested implementation milestones

### Milestone 1 --- JPEG inspection (complete)

- import supported JPEGs, parse structure, and show a separate decoded-pixel preview;
- show component-aware block and MCU overlays.

### Milestone 2 --- Coefficient access prototype (complete)

- inspect quantized DCT coefficients through the libjpeg-turbo WebAssembly bridge;
- keep coefficient data distinct from the pixel preview and source bytes.

### Milestone 3 --- Document and operation history (complete)

- preserve immutable source bytes and implement versioned, replayable operation history;
- support image-pixel selections/masks, undo/redo, and reset.

### Milestone 4 --- First DCT editing vertical slice (complete)

- brush masks and sampling-aware mapping from image pixels to visible DCT blocks;
- component and AC frequency-band selection;
- zero selected AC coefficients and preview/export by JPEG re-encoding;
- before/after comparison, undo/redo, and explicit re-encoding status.

The implemented DCT operation zeros the selected natural-order AC band
(`u + v` 1–2, 3–5, 6–14, or 1–14); it does not yet scale or randomize
coefficients. The supported JPEG subset and re-encoding/metadata limits are
recorded in `docs/ROADMAP.md` and ADR-005.

### Milestone 5 --- First Glitch Lab (complete)

- coefficient zero/scale/randomize and DC offset;
- separate DC and AC targeting, component selection, and block repeat;
- DQT matrix editing and pattern generation with explicit reinterpret/requantize semantics.

### Milestone 6 --- Two-image transplant

- source/target documents and DCT block or AC/DC transplant;
- validate component layout, sampling, block geometry, quantization assignments, and scan/process compatibility.

### Milestone 7 --- Experimental bitstream lab

- marker/scan and restart-marker inspection;
- isolated raw-byte and bitstream experiments with decoder recovery diagnostics.

### Milestone 8 --- Project persistence and polish

- versioned local project persistence and remaining product polish.

## 16. Open technical decisions

The initial codec and baseline-only process boundary are recorded in ADR-003
and ADR-005. DQT semantics and the experiment-first product priority are
recorded in ADR-006. Remaining decisions include:

1.  Which operations can be evaluated incrementally, and which require
    full re-encoding?
2.  How much of the raw entropy stream should be exposed in the experimental release?
3.  Should project files embed source JPEG bytes or reference a local
    file selected again on reopen?

## 17. Important terminology

Use these terms consistently in the UI and documentation:

- **Pixel:** decoded image sample.
- **DCT block:** 8×8 coefficient block for one component.
- **MCU:** Minimum Coded Unit, determined by component sampling
  factors.
- **Quantized DCT coefficient:** integer coefficient after
  quantization.
- **Quantization table (DQT):** 64 values controlling quantization.
- **Entropy-coded scan:** compressed bitstream for a JPEG scan.
- **Marker segment:** structural JPEG element.
- **Re-encoding:** decoding and encoding a new JPEG representation.
- **Databending:** artistic manipulation of encoded file data; not a
  single standardized algorithm.
- **Stream transplant:** experimental transfer of encoded scan data,
  requiring bitstream-aware handling.

---

## Product definition in one sentence

A browser-based, non-destructive visual editor in which users paint and
manipulate the internal structures of JPEG images---DCT coefficients,
quantization tables, blocks, MCUs and, in an advanced experimental mode,
entropy-coded streams and raw bytes---with Photoshop-like tools, masks,
previews, layers and history.
