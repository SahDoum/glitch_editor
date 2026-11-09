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

For the implemented UI and reusable experiment-brush interaction pattern,
see [the interface guide](./docs/INTERFACE.md). The requirements below include
future capabilities and must not be interpreted as implementation claims.

### 6.1 Main layout

A desktop-oriented responsive workspace:

- **Top bar:** file name, open/import, save project, export, undo,
  redo, compare.
- **Left tool rail:** grouped tool icons for **Manipulation** (Hand,
  Inspector), **Coefficients** (Brush, Select), **Blocks** (Repeat
  Block, Shuffle), and **Quantization** (Quantization Matrix). The
  selected tool has a clear active state.
- **Center canvas:** image preview with zoom and pan.
- **Right column:** the selected tool's contextual panel, followed by
  History, ORIGINAL ASSET, JPEG INSPECTOR, FRAME COMPONENTS, DQT
  QUANTIZATION TABLES, BLOCK GEOMETRY, and ENCODED FILE sections, in
  that order.

The right column can be collapsed as a whole; each of its sections can
also be collapsed independently. Selecting a tool opens its contextual
panel in the right column. On narrow screens, side panels may collapse
into drawers. The application is primarily designed for desktop
browsers.

### 6.2 Canvas

Required interactions:

- zoom in/out and fit image;
- pan;
- pixel-accurate cursor coordinates;
- optional overlay for 8×8 block grid;
- optional MCU grid;
- pixel-space rectangular selection and continuous brush selection;
- selection overlay that keeps the edited preview visible;
- show/hide original;
- split-view or difference preview;
- indicate when the displayed preview is approximate or stale.

The canvas displays a decoded preview. The source JPEG data remains a
separate authoritative document model.

Brush and Select are mask-authoring tools, separate from JPEG-effect
tools. They edit a draft mask in image-pixel coordinates. DCT-block
snapping is the default and uses the selected component's sampling-aware
block footprint; an explicit MCU grid is available. Brush sample centers
snap to that grid and its mask is mapped to whole component blocks by the
JPEG operation pipeline. Rectangle edges snap to the same grid. The current
draft is used for Coefficient Glitch, its recipes, and Block Shuffle; named
masks are no longer exposed in the interface. These tools show the mask they
will use and retain an immutable snapshot when applied, so later
mask edits cannot rewrite prior results. A history entry containing a mask
can restore a copy as the current draft, replacing any existing draft without
changing history or the image and without a confirmation dialog. Mask overlays are also shown while authoring;
tools that do not use masks hide them without clearing mask data.

### 6.3 Tool inspector

The tool bar is the single entry point for selecting tools. Each tool
has an icon, an accessible name, and a visible selected state. Selecting
a tool displays its contextual menu/settings in the right column; tool
controls must not be scattered across unrelated inspector sections.
Every tool exposes:

- tool name and short explanation;
- target domain (DCT, quantization, MCU, entropy stream, raw bytes);
- parameters with sensible ranges;
- affected component(s);
- blend/application mode where meaningful;
- deterministic seed for random behavior;
- Apply/preview controls where computation is expensive;
- Reset tool settings.

Inspector is a manipulation tool, not a separate “Inspect one block”
command. With Inspector active, clicking an 8×8 DCT block selects and
highlights that block and displays its details in JPEG INSPECTOR. The
selected block is distinct from mask drafts and saved pixel-space masks.

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

### 6.5 Masks, recipes, and compact workflow

Keep mask authoring distinct from applying JPEG-domain edits. An effect
history entry keeps its own mask snapshot and stable mask ID. Use
image-pixel coordinates as the
stored mask representation, with sampling-aware snapping to component
8×8 DCT-block footprints by default and an explicit MCU-grid mode.

Offer named built-in coefficient recipes and allow users to compose and
save ordered coefficient-operation sequences under their own names.
Recipes are parameter data, never executable code, and are stored locally
in the browser. Applying a multi-step recipe is one undoable history
action. Each recipe step is labeled as a quantized-coefficient edit that
produces a re-encoded JPEG; it is not raw-byte or entropy-stream damage.

Coefficient effects expose one component and coefficient operation at
a time. Pixelate is a fixed preset of Zero that clears all AC coefficients in
the selected component. The separate Zero effect lets users target DC or a
chosen AC frequency zone through the DCT matrix. Chroma Scale scales all AC
coefficients by two by default, with an adjustable multiplier. A persisted
setting for each effect selects whether a completed mask is applied immediately
or using the Apply button. Successful automatic operation creation clears the
draft mask; failed validation leaves it intact.

Reduce redundant canvas/tool spacing and show toolbar icons with
accessible names and tooltips at constrained widths. Keep original/result
comparison, active-tool context, errors, and export status visible without
a persistent lower status strip. Focused DQT cells remain visibly focused
in the matrix editor.

Coefficient brushes can already apply an experiment after a completed mask
gesture when automatic application is enabled. This creates a reversible
operation with an immutable mask snapshot; it is not continuous pixel painting.

## 7. Tool specification

Tools are grouped by the JPEG representation they manipulate. All
region-based tools should support a mask or selection where technically
meaningful.

### 7.1 Navigation and selection

**Pointer / Hand** - select and move around the canvas; - pan and zoom.

**Rectangular selection** - create a pixel-space mask region; - show its
intersecting DCT blocks and MCUs; - snap to the selected component's DCT
blocks by default or to MCUs in explicit MCU-grid mode.

**Brush mask** - paint an editable mask; - brush size, hardness,
opacity; - snap sample centers to the selected DCT/MCU grid.

The mask is a spatial control surface. The engine must map it to the
appropriate JPEG units for each operation. Coefficient Glitch and
Block Shuffle consume the current draft mask; DCT block and MCU coordinates remain
separate from image-pixel coordinates.

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

The initial glitch lab exposes zero, scale, seeded randomize, AC sign
inversion and frequency isolation for selected coefficients, plus a
signed DC offset. Coefficient ranges are bounded to the baseline
representation supported by the current encoder. Randomize stores an
unsigned 32-bit seed so replay is reproducible. Coefficient Glitch is a
separate effect tool and requires a current draft mask.

**Experiment recipes** - choose a named built-in recipe or a locally
saved user recipe; - recipes contain ordered coefficient-operation
parameters and seeds, not executable scripts; - applying a sequence is
one undoable operation and uses the selected mask snapshot.

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

## 8. Intra-image block transform and scan corruption

### 8.1 Block Transform workflow

The first block-transfer workflow uses one JPEG document. A **Block
Transform** tool groups whole-block shuffle, copy/repeat, and direct region
transfer in one contextual panel while keeping their operation semantics
distinct.

For direct transfer, the user click-drags a rectangular source selection on
the canvas. Its edges snap to the active component's visible 8×8 DCT-block
grid. The user then drags the selected rectangle to a destination; a snapped
ghost previews the exact destination before drop. The operation translates
the selected block rectangle without scaling or interpolation. Default to
copy; expose swap only as an explicit mode. Do not call copy "move": a true
move must define what fills the source region.

The user chooses whether to transfer all 64 quantized coefficients, DC only,
or AC only. Whole-block transfer includes DC and AC. DC-only keeps the
destination's AC coefficients; AC-only keeps its DC coefficient. Source
coefficients are snapshotted before writing, so overlapping copies and swaps
have deterministic semantics. Source and destination must be equal-sized,
in-bounds rectangles in the same component. Only visible component blocks
are selectable; padded edge blocks are not exposed.

Shuffle is a seeded permutation of whole selected blocks within a component
region. Copy/Repeat writes a source block to explicit same-component
destinations. These modes may share the tool and canvas selection, but remain
separately named operations in history. None copies MCU byte ranges or
entropy-coded data. Each operation changes quantized coefficients and
produces a re-encoded JPEG; the original JPEG bytes remain unchanged.

The experimental DC steps brush rounds selected quantized DC coefficients
to multiples of an integer step while leaving AC unchanged. It can create
blockwise tonal steps, but is not pixel posterization; the visible result
depends on the image and its quantization tables.

The experimental Ringing brush retains DC and AC below u+v 3, amplifies AC
at u+v 3 and clears higher AC in masked blocks of a selected component.
A separate AC low-pass mode retains a configurable cutoff. These blockwise
operations may produce halos, blur or blocking; they do not detect edges or
guarantee ringing.

The experimental Engraving brush keeps DC and amplifies AC on a single
DCT frequency axis, clearing the remaining AC in masked blocks of one
component. Horizontal and vertical directions are selectable; it does not
remove chroma automatically or guarantee an engraving-like appearance.

Local shift copies source DCT blocks from an immutable pre-operation snapshot
to masked destinations in the same component, offset by whole component
blocks. A destination with an out-of-bounds source remains unchanged. The
mask uses the same 50% coverage threshold as Shuffle; choosing a chroma
component permits experimentation with color misalignment. It is not a
fractional-sample shift, an MCU transform, or an entropy-stream operation.

### 8.2 Scan Corrupt workflow and history

Scan Corrupt is a separate advanced tool that acts on the entropy-coded scan
of a temporary JPEG produced by the editor's supported encoder, after all
coefficient/DQT operations. It does not edit DCT coefficients. Controls include
a bounded scan-relative range, corruption mode, bounded count/strength, and
a reproducible unsigned seed. Scan-relative position must not be presented
as an image-space location or guaranteed visual location.

Keep stream corruption as a terminal phase in the operation pipeline:
coefficient or DQT operations cannot be added after it without explicitly
discarding the stream-corruption stage and regenerating the clean encoded
JPEG. Undo returns to that clean encoded result; redo replays corruption with
the recorded parameters and seed. If the experiment supports multiple
corruption stages, they are explicitly ordered byte-domain stages; they must
not trigger a hidden JPEG re-encode between stages.

The UI distinguishes corruption completion from preview-decode success.
Complete decode failure is an expected possible outcome, not grounds to
discard the experiment. Keep the corrupt bytes exportable with a warning and
the last clean encoded preview available for comparison and undo. Never
silently replace the failed stream preview with a pixel-filter approximation.

Initially accept only the editor's verified baseline sequential, single-scan
output. Validate scan boundaries and preserve structural markers, restart
markers, and byte-stuffing boundaries. If the implementation cannot prove
the editable range or protect structural regions, reject that input before
editing. These checks protect file structure; they do not guarantee that a
decoder can recover a corrupted entropy stream. Scan Corrupt rejects
Progressive JPEG; do not claim progressive, arithmetic-coded, multi-scan, or
general raw-byte editing support for it.

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

A The versioned `.jpglitch` project file is JSON and embeds the exact original
JPEG bytes as Base64, together with the operation stack, draft mask, random
seeds, and scan-corruption stages. The source digest and byte length are
verified when reopening. The file is portable and does not rely on a path or
browser-local storage. The embedded source remains subject to the 50 MiB JPEG
limit; Base64 makes the project file roughly one third larger than its source.

Reopening replays the saved operations against the embedded original. The
application and codec versions are stored; when they differ from the current
versions, the editor warns that replayed output may differ. The project file
does not store a preview or the editor's undo/redo timeline. Saving is
user-initiated rather than automatic, so large source files are not silently
duplicated in browser storage.

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

### Milestone 6 --- Usable tool and inspector workflow (complete)

- grouped top toolbar with Hand, Inspector, Brush, Select, Repeat Block,
  Shuffle, and Quantization Matrix;
- separate mask-authoring and JPEG-effect tools;
- continuous, translucent, borderless brush-selection overlay and framed
  rectangular selection, snapped to a sampling-aware DCT/MCU grid;
- Inspector tool selects/highlights a clicked 8×8 DCT block and shows its
  details in JPEG INSPECTOR;
- contextual settings for the active tool and a collapsible right column
  with independently collapsible information sections.

### Milestone 6.5 --- Mask and experiment workflow (implementation slice)

- image-pixel mask drafts and immutable snapshots in effect history;
- mask-consuming coefficient effects use the current draft, display it, and store immutable mask snapshots in
  their history entries;
- named built-in coefficient recipes and locally saved user sequences,
  each applied as one undoable operation;
- active-tool-specific overlays, DCT-default/MCU-selectable snapping,
  compact responsive toolbar, and no persistent lower status strip;
- an experiment catalog distinguishing coefficient/DQT re-encoding from
  future stream and raw-byte experiments.

### Milestone 7 --- Intra-image DCT block transform

- a unified Block Transform tool for same-image Shuffle, Copy/Repeat, and
  drag-to-transfer of snapped, equal-size block regions;
- whole-block, DC-only, and AC-only coefficient modes with compatible-region
  validation, re-encoding, preview, and reversible history.

### Milestone 8 --- Experimental entropy-coded scan corruption

- seeded, bounded corruption of a verified scan from the editor's supported
  baseline single-scan encoder, isolated after the normal coefficient pipeline;
- structural boundary protection, preview-decode diagnostics, retained export
  for undecodable experiments, and undo to the clean encoded result.

### Progressive JPEG support

- Import accepts 8-bit baseline sequential and progressive (SOF2) Huffman JPEG,
  grayscale or three-component. All progressive scans are consumed by
  libjpeg-turbo, giving complete quantized coefficients to the existing
  operations; damaged or truncated progressive data is rejected.
- Export offers an output mode, baseline or progressive, chosen in the Save
  dialog and independent of the source process. Progressive output uses the
  libjpeg-turbo default progressive script (no custom scripts) and is a
  coefficient re-encode, not an RGB round trip.
- Scan Corrupt remains baseline-only; its results are always saved as baseline.
- Progressive-specific glitches (scan-level corruption, dropping or
  truncating refinement scans, spectral-band scan reordering) are not
  implemented yet; the multi-scan structure is the basis for them.

### Milestone 9 --- Project persistence and polish

- versioned local project persistence and remaining product polish.

Two-image transplant, cross-component conversion, stream transplant,
general-purpose raw-byte editing, and progressive/multi-scan support remain
deferred. (Progressive JPEG import/export of coefficient edits is supported:
see "Progressive JPEG" below; only progressive scan corruption and custom scan
scripts are deferred.) The block-transfer milestone edits quantized coefficients within a
single component; the scan-corruption milestone edits encoded scan bytes and
may produce an undecodable JPEG. These are separate operation domains and
must not be presented as one effect.

## 16. Open technical decisions

The initial codec and baseline-only process boundary are recorded in ADR-003
and ADR-005. DQT semantics and the experiment-first product priority are
recorded in ADR-006; the tool/selection workflow priority is recorded in
ADR-007. Remaining decisions include:

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
