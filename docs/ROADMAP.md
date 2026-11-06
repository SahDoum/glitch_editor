# Roadmap — JPEG Glitch Editor

**Status:** proposed sequence; reorder only after recording the reason.  
**Delivery style:** vertical slices with acceptance criteria. Each item should become a small issue/PR.

## Working rules

- Keep each issue small enough to review independently.
- Every milestone ends with a runnable application and demonstrable acceptance checks.
- Do not start advanced entropy-stream work before coefficient editing and export are reliable.
- Record scope changes in `docs/DECISIONS.md`.
- Treat support for a JPEG process as a product claim that requires fixtures and tests.

## Milestone 0 — Repository and engineering foundation (complete)

### Tasks

- [x] Initialize TypeScript application and package scripts.
- [x] Add formatting, linting, type checking, and unit-test runner.
- [x] Add CI for install, lint, typecheck, tests, and production build.
- [x] Add `AGENTS.md`, `PRODUCT.md`, and architecture docs.
- [x] Define error/result conventions and logging policy.
- [x] Create a small fixture corpus with licensing/provenance notes.

### Acceptance

- Clean checkout can install, test, and build using documented commands.
- CI runs on every pull request.
- No image is uploaded to a server.

## Milestone 1 — Import and JPEG Inspector (complete)

### Tasks

- [x] File picker and drag-and-drop import.
- [x] Preserve exact source bytes and calculate a content digest.
- [x] Parse and display marker sequence and segment boundaries.
- [x] Display dimensions, process, precision, components, sampling factors, and table assignments.
- [x] Decode and display a preview.
- [x] Report unsupported/malformed JPEGs clearly.
- [x] Add block and MCU geometry overlays where geometry is known.

### Acceptance

- [x] Open known-good baseline JPEG fixtures.
- [x] Inspector output matches fixture metadata verified against the fixture manifest and ImageMagick.
- [x] Original bytes remain unchanged after inspection.
- [x] Unsupported formats fail visibly and safely.

The inspector supports 8-bit baseline sequential Huffman JPEG with one
interleaved scan and either one grayscale or three components. Coefficient
inspection remains in Milestone 2, after codec evaluation; the browser-decoded
pixel preview is not treated as JPEG coefficient data. Inputs are limited to
50 MiB, 40 megapixels, and 10,000 markers; marker parsing runs in a cancellable
Web Worker.

## Milestone 2 — Coefficient access prototype

### Tasks

- [x] Evaluate candidate codec/WASM options for coefficient read/write access.
- [x] Document licensing, package size, browser compatibility, and JPEG process support.
- [x] Build a small prototype that reads quantized coefficient arrays.
- [x] Map component/block coordinates to image and MCU coordinates.
- [x] Inspect one selected block's 64 coefficients.
- [x] Compare results against an independent reference implementation for the native C bridge.

### Acceptance

- Chosen codec can read coefficient data for the explicitly supported JPEG subset.
- Coordinate mapping is tested for grayscale and common subsampling modes.
- No production codec choice is made without a written decision record.

The libjpeg-turbo C bridge, worker adapter, block inspector UI, and coordinate
mapping were introduced here. The native bridge matched `jpegio` 0.2.8 for all
37 coefficient blocks across five synthetic fixtures. Milestone 4 extends this
bridge to coefficient edits and re-encoding; see ADR-003 and ADR-005.

## Milestone 3 — Document model and operation history

### Tasks

- [x] Define immutable original asset and editable document representations.
- [x] Define versioned operation schema and registry.
- [x] Implement operation stack, undo/redo, enable/disable, delete, and parameter editing.
- [x] Add selection and mask representation.
- [x] Add deterministic seeded random utility.
- [x] Handle stale asynchronous preview results.

### Acceptance

- [x] Operations can be replayed deterministically from the original document.
- [x] Undo/redo restores the exact prior editable state.
- [x] Reordering recomputes downstream operations and does not assume commutativity.
- [x] Original bytes are always recoverable.

The immutable document model, version-1 operation registry/serializer,
ordered replay history, image-pixel selections and masks, seeded random
utility, and stale-preview coordinator are implemented. Spatial masks and DCT
operations are replayed from the immutable original; coefficient edits do not
mutate the imported bytes. See `docs/DECISIONS.md` ADR-004 and ADR-005.

## Milestone 4 — First DCT editing vertical slice

### Tasks

- [x] Add canvas navigation and block overlay.
- [x] Add brush mask and block-aware selection.
- [x] Implement zeroing selected AC coefficients in one frequency band.
- [x] Add component and frequency-band selection.
- [x] Preview by encoding/decoding through the selected codec.
- [x] Export the resulting JPEG.

### Acceptance

- [x] User can import a supported JPEG, paint a mask, apply a DCT operation, compare before/after, undo/redo, and export.
- [x] Export opens in independent decoders in native bridge validation.
- [x] UI explicitly identifies the result as re-encoded.

The initial operation zeros AC coefficients whose natural-order `u + v`
frequency falls in the selected band (low 1–2, mid 3–5, high 6–14, or all
1–14); DC is retained. The mask is in image-pixel coordinates and is mapped to
visible 8×8 DCT blocks for the chosen component, accounting for sampling
factors. The current supported subset remains 8-bit baseline sequential
Huffman JPEG with grayscale or three components and one interleaved scan.
Progressive, arithmetic-coded, multi-scan, and other unsupported inputs are
rejected.

Each preview/export starts from the original JPEG, replays enabled operations
in order, writes a new JPEG, then decodes that output for preview. The original
asset remains byte-for-byte unchanged. Re-encoding does not promise metadata
preservation: the bridge copies saved APP/COM markers except APP0 and APP14;
the codec may generate its own JFIF marker. The app lazily loads the generated
WASM codec, built with `npm run build:jpeg-codec` using Emscripten 4.0.23.
Input/output JPEGs are capped at 50 MiB, coefficient storage at 128 MiB, and
worker DCT processing is bounded. See ADR-005 for the codec decision and
export behavior.

## Milestone 5 — First Glitch Lab (implementation complete; codec rebuild pending)

### Tasks

- [x] Inspect and edit natural-order 8×8 DQT matrices.
- [x] Define table reinterpretation and controlled re-quantization semantics.
- [x] Add coefficient zero, scale, seeded randomize, AC inversion, and frequency isolation.
- [x] Add DC offset and independent DC/AC targeting.
- [x] Add component-specific DCT block duplicate/repeat.
- [x] Add seeded whole-block Fisher–Yates permutation inside a selected component mask.
- [x] Support independent coefficient edits to a selected chroma component.
- [x] Add flat, stripe, radial, and seeded-random DQT patterns.
- [x] Preserve/export encoded experiments when the browser decoder cannot preview them.
- [x] Rebuild the generated WebAssembly bridge with Emscripten 4.0.23 and smoke-test representative operations in the browser.

### Acceptance

- Original JPEG bytes remain unchanged and every operation is undoable/replayable.
- Coefficient results and seeded patterns are deterministic and tested at the representation being edited.
- Block permutation moves whole quantized 8×8 blocks including DC, preserves the selected block multiset, and leaves blocks outside the mask untouched.
- AC inversion changes signs only; frequency isolation retains one selected AC band and leaves DC unchanged.
- DQT reinterpretation and requantization are distinct, documented operations; neither claims to restore discarded detail.
- Block operations stay within one component and reject out-of-grid destinations with an actionable explanation.
- A failed browser preview does not discard an encoded experiment; export remains available.
- The default output encoder currently supports only 8-bit baseline sequential Huffman JPEG with one grayscale or three-component frame and one interleaved scan.

The product goal is visual experimentation, not a guarantee that every
intervention produces a universally decodable JPEG. This slice keeps the
coefficient re-encoder for predictable previews, while retaining an encoded
result for export even when browser preview decoding fails. Raw entropy/byte
corruption remains isolated to Milestone 8. The generated bridge was rebuilt
with Emscripten 4.0.23; the production browser preview imported a synthetic
JPEG and successfully applied block repeat, AC inversion, frequency isolation,
block permutation, and a radial DQT edit. Each operation appeared as applied
in history, and export became available. Native C semantic checks and
independent `djpeg`/ImageMagick decoding also passed. Browser export capture
produced a 667-byte JPEG with SOI and EOI markers. The operation catalog,
parameters, examples, and experiment results are recorded in
`GLITCH_EXPERIMENTS.md`.

## Milestone 6 — Usable tool and inspector workflow (complete)

### Tasks

- [x] Replace the left-side tool grouping with a top tool bar: Manipulation (Hand, Inspector), Coefficients (Brush, Select), Blocks (Repeat Block, Shuffle), and Quantization (Quantization Matrix).
- [x] Give every tool an icon, accessible name, selected state, and contextual settings panel in the right column.
- [x] Make Brush and Select edit one persistent global pixel-space selection; switching tools must not clear or hide it.
- [x] Make brush input produce a continuous pixel-space selection region and render only the complete component DCT blocks affected by the mask, without round edges or partial blocks. Keep the rectangular Select frame visible.
- [x] Remove the separate “Add selection mask” action; both selection tools edit the current global selection directly.
- [x] Make Inspector select and highlight an 8×8 DCT block on canvas click and show its coefficient details in JPEG INSPECTOR; remove the separate “Inspect one block” action.
- [x] Put the tool panel above History and the ORIGINAL ASSET, JPEG INSPECTOR, FRAME COMPONENTS, DQT QUANTIZATION TABLES, BLOCK GEOMETRY, and ENCODED FILE sections in the right column.
- [x] Make the whole right column collapsible and each listed section independently collapsible.
- [x] Add focused UI-state tests for tool switching, shared selection persistence/rendering, block inspection state, brush rendering, and panel collapse behavior.

The toolbar and inspector workflow use presentation state separate from the
JPEG document and operation model. Rectangle selection and brush masks are the
same global image-pixel selection used by coefficient operations; changing
tools only changes the active tool and never discards that mask. Brush samples
render as a translucent overlay of the complete component DCT blocks the mask
affects; the stored brush geometry and effect coverage remain unchanged.
Rectangular selections retain a visible dashed frame. Inspector clicks map image pixels to the selected
component's visible 8×8 DCT block using sampling-aware block geometry, then
read quantized coefficients through the existing WebAssembly reader. The
selected block is distinct from the spatial selection. Tool, history, original
asset, JPEG inspector, component, DQT, geometry, and encoded-file sections can
be collapsed independently, as can the complete right panel.

Validation: `npm run check` passed with 15 test files and 81 tests. Browser
smoke testing confirmed JPEG import, tool groups, rectangle and brush selection,
coefficient inspection/highlighting, and independent section/right-panel
collapse. No browser console or page errors were observed.

### Acceptance

- The top tool bar presents exactly the named groups and tools, and selecting a tool visibly activates it and opens its settings in the right column.
- Brush and Select always expose the same global image-pixel selection; switching between them preserves that area, and a spatial operation uses that visible area.
- Brush selection highlights only complete component DCT blocks that will be affected, leaving preview changes visible; rectangular Select keeps its frame.
- There is no separate “Add selection mask” action or “Inspect one block” command.
- Clicking a block with Inspector active highlights the selected 8×8 DCT block and shows its coefficient details without changing the global pixel-space selection.
- The right column and each information section can be collapsed/expanded independently without changing the document, selection, or operation history.
- Existing JPEG-domain operations, undo/redo, and original-byte preservation are unchanged.

This usability milestone is intentionally prioritized before new JPEG
workflows: users need to understand which tool is active and which
pixel-space region an operation will affect before adding two-image
transplant or entropy-stream features. It changes the UI workflow, not
the document representation, JPEG capability claims, or codec pipeline.

## Milestone 6.5 — Mask and experiment workflow (implementation complete)

Decisions confirmed by the user and recorded in ADR-008:

- Brush and Select author masks; effects consume reusable named masks.
- DCT block snapping is the default, with a selectable MCU grid.
- Recipes include built-in presets and user-saved ordered coefficient
  sequences.
- Block displacement and image mixing remain separate future
  coefficient-domain slices; neither is raw-byte copying.
- A combined mask-and-effect brush remains a later interaction experiment,
  built on the same reversible mask-snapshot contract.

### Tasks

- [x] Record mask ownership, grid, overlay, and recipe choices in ADR-008 and update product and architecture documentation.
- [x] Separate mask authoring from mask-consuming effects; save named masks in operation history and retain a mask snapshot per applied operation.
- [x] Add sampling-aware DCT-default and MCU grid snapping for brush sample centers and rectangular selections; test odd dimensions and subsampled components.
- [x] Hide unrelated overlays on tool changes without clearing masks or Inspector state; keep focused DQT cells visible in the matrix editor.
- [x] Add named built-in recipes and locally saved user-authored multi-step coefficient sequences; apply each sequence as one undoable operation.
- [x] Compact toolbar, canvas, and right-panel spacing while retaining original/result, tool, error, and export feedback.
- [x] Add a glitch catalog naming edited representation, processing stage, re-encoding, and decode limitations.
- [x] Keep JPEG coefficient/DQT edits distinct from future entropy-stream and raw-byte experiments; do not add pixel-only fallbacks under JPEG-glitch tool names.

### Acceptance

- Mask creation and effect application are distinct; saved masks and recipe applications can be undone/redone.
- Brush and rectangular selection obey the sampling-aware DCT/MCU grid.
- Changing tools hides irrelevant overlays without erasing mask data or changing document history.
- Recipes are named, discoverable, validated, deterministic where seeded, and applied as one history entry.
- Compact layout preserves access to original/result, tool context, useful errors, and export state.
- The experiment catalog distinguishes coefficient/DQT re-encoding from stream/byte corruption and never calls the decoded preview the original JPEG.
- Block displacement and image mixing are described as separate, reversible coefficient-domain operations with component/grid compatibility checks; raw-byte copying is not used as a substitute.
- The DQT table assignment remains selected after applying a matrix edit; the editor no longer remounts on every history revision.
- Follow-up: Coefficient Glitch, recipes, and Shuffle show the mask they use; a newly drawn draft is used by default without saving, and saved masks remain selectable.
- History entries with mask snapshots can restore independent copies as the current draft without changing history or the encoded image.

## Milestone 7 — Two-image DCT transplant

### Tasks

- [ ] Add source and target document workflow.
- [ ] Add source/target region selection.
- [ ] Transplant DCT blocks and separately DC/AC data.
- [ ] Check component layout, sampling, block geometry, quantization assignments, scan/process compatibility.
- [ ] Preview and commit transplant as a reversible operation.

### Acceptance

- Compatible transplants produce a valid export.
- Incompatible cases are rejected or converted only through an explicitly documented path.
- No arbitrary byte copy is described as a block/MCU transplant.

## Milestone 8 — Experimental stream and byte lab

### Tasks

- [ ] Add marker/scan and restart-marker inspector.
- [ ] Add isolated raw-byte sandbox with protected structural regions by default.
- [ ] Add bit/byte corruption with deterministic seeds.
- [ ] Prototype entropy-stream editing/transplant only with bitstream-aware handling.
- [ ] Add decoder recovery diagnostics and failure preview.
- [ ] Keep original asset immutable.

### Acceptance

- Experimental actions cannot overwrite original bytes.
- Decoder failures are expected, contained, and clearly explained.
- Any claimed stream-level operation has dedicated fixtures and bitstream tests.

## Milestone 9 — Project persistence and polish

### Tasks

- [ ] Define project file format and schema version.
- [ ] Save/reopen operation stack, masks, parameters, and source asset or relink metadata.
- [ ] Add autosave/recovery if appropriate.
- [ ] Add keyboard shortcuts and accessibility pass.
- [ ] Profile large images and optimize only measured bottlenecks.
- [ ] Browser compatibility and security review.

### Acceptance

- Project reopens with the same operation stack and reproducible result.
- Large-file processing reports progress and remains responsive.
- No source asset is silently lost.

## Next issues — Milestone 7

1. Define compatible source/target JPEG document handling for a two-image workflow.
2. Select source and target regions and map them to sampling-aware DCT-block regions.
3. Implement reversible coefficient-block transplant and separately scoped DC/AC transfer.
4. Reject incompatible component layouts, block geometry, DQT assignments, or JPEG processes with actionable errors.
5. Test compatible and incompatible transplants against supported fixtures and independent decoders.

## Explicitly deferred

- Full progressive JPEG editing until scan model is designed.
- Arithmetic-coded JPEG unless a concrete codec and test plan support it.
- Arbitrary entropy stream transplant before bitstream-aware prototype passes.
- GPU acceleration before profiling.
- Mobile-first UI and Photoshop feature parity.
