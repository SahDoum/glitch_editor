# Roadmap — JPEG Glitch Editor

**Status:** proposed sequence; reorder only after recording the reason.  
**Delivery style:** vertical slices with acceptance criteria. Each item should become a small issue/PR.

## Working rules

- Keep each issue small enough to review independently.
- Every milestone ends with a runnable application and demonstrable acceptance checks.
- Do not start advanced entropy-stream work before coefficient editing and export are reliable.
- Record scope changes in `docs/DECISIONS.md`.
- Treat support for a JPEG process as a product claim that requires fixtures and tests.

## Current development priorities — interface and experiment brushes

The current UI and its verified implementation boundaries are described in
[INTERFACE.md](./INTERFACE.md). These priorities supersede the ordering of
the historical «Next issues» list below; they do not imply that all listed
capabilities are already implemented.

### Next: research JPEG artifacts, then propose experiment brushes

- [ ] Research a focused set of observable JPEG artifacts and techniques using
  traceable sources and small licensed or synthetic fixtures. For each
  candidate, identify the JPEG representation involved, the actual mechanism,
  typical visual manifestation and its dependence on image content,
  component, sampling and codec; record uncertainty and source provenance.
- [ ] Map each candidate to existing typed operations and supported JPEG
  processes. Clearly distinguish quantized coefficient edits, DQT
  reinterpretation/requantization, block operations, entropy-coded scan
  edits and raw-byte corruption. Do not frame JPEG as video datamoshing.
- [ ] Propose a short, user-reviewable set of new icon-based brushes with
  names, domain, exact default parameters, meaningful controls, area of
  effect, deterministic seed if applicable, re-encoding/decode risks and
  example before/after outcomes. Do not claim a visual outcome is universal.
- [ ] Obtain an explicit decision before adding new public formats,
  dependencies, operations, codec capabilities or support for additional
  JPEG processes. Keep raw/entropy experiments isolated; no hidden pixel
  substitutes or modifications of source bytes.
- [ ] Implement selected brushes as small vertical slices, reusing existing
  typed operations and the interaction principles in
  [INTERFACE.md](./INTERFACE.md). Test parameter mapping and boundaries,
  reproducible results, current-mask behavior where applicable, history,
  errors and supported/unsupported inputs. Use deterministic visual and
  coefficient-level golden fixtures, independent decoding and other
  representation-specific checks where practical.
  Update the experiment catalog only for verified behavior.

#### Candidate artifact brushes to investigate

These are research candidates, not implemented brushes or proven mappings
to the current coefficient operations. Establish the mechanism and a
reproducible example for each before selecting parameters or promising a
visual result.

- [ ] **Ringing:** investigate oscillations around high-contrast edges in
  reconstructed 8×8 DCT blocks, including the hypothesis that suppression
  or loss of precision of high-frequency coefficients contributes to them.
  Compare frequency bands, quantization and edge alignment.
- [ ] **Posterization:** investigate whether JPEG quantization can produce a
  useful posterization-like appearance, and distinguish it from deliberate
  pixel-value or palette reduction. Identify image and gradient conditions
  and whether existing JPEG-domain operations can reproduce it.
- [ ] **Contouring / banding:** investigate visible steps in smooth gradients,
  potential relationships with quantization and posterization, and whether
  this warrants a distinct brush or a shared experiment. Do not assume the
  same mechanism or outcome without evidence.
- [ ] **Blockiness in busy regions:** investigate how block boundaries become
  visible in detailed or textured regions, how this differs from blockiness
  in smooth areas, and which coefficient-domain manipulations can create a
  controllable effect without conflating blocks with MCUs.
- [ ] **Staircase noise:** define the desired appearance on diagonal edges;
  investigate whether it arises from DCT quantization, chroma subsampling,
  aliasing or another mechanism in each example. Only propose a JPEG-domain
  brush if its mechanism and limitations are supported by evidence.

### Remaining interface work

- [ ] Consider the icon-based experiment-brush paradigm for other tools
  where technically appropriate, without implying all operations use masks.
- [ ] Improve the compactness and readability of history while preserving
  enable/disable, order changes, removal, mask restoration and Undo/Redo.
- [ ] Evaluate a compact right panel with Effect / History / Information tabs;
  preserve inspector access, collapsed state, keyboard access and error
  visibility. This remains a proposal, not the current layout.
- [ ] Improve built-in brush names, descriptions and icons using observed,
  validated outcomes; maintain access to existing user brushes and recipes.
- [ ] Check keyboard access, accessible names, focus states and responsive
  layout as the interface evolves, without hiding errors or original comparison.
- [ ] Evaluate temporary live preview only after performance measurement and a
  separate product decision; handle stale worker responses, cancellation and
  unconfirmed output explicitly.

### Deferred: further mask and eraser development

Do not treat these as prerequisites for brush research or routine interface
work. Keep the existing single-shape mask behavior and immutable snapshots
honestly documented until the user reprioritizes this work.

- [ ] Add combining multiple strokes/rectangles and erasing/subtraction.
- [ ] Define shared undo/redo for mask changes and effects, including reset,
  mask restoration and error handling.
- [ ] Consider mask visibility/opacity controls and explicit whole-image
  selection.
- [ ] Before implementation, agree on versioning, migration, work limits and
  compatibility with existing operation snapshots and named-mask data;
  test sampling-aware coverage and overlay consistency. Do not change the
  representation or public interfaces without the required approval.

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
pixel-space region an operation will affect before adding block-transform
or entropy-stream features. It changes the UI workflow, not
the document representation, JPEG capability claims, or codec pipeline.

## Milestone 6.5 — Mask and experiment workflow (implementation complete)

Decisions confirmed by the user and recorded in ADR-008:

- Brush and Select author masks; effects consume reusable named masks.
- DCT block snapping is the default, with a selectable MCU grid.
- Recipes include built-in presets and user-saved ordered coefficient
  sequences.
- Block displacement is now scoped in Milestone 7 as a same-image
  coefficient-domain operation; image mixing remains deferred. Neither is
  raw-byte copying. See ADR-009 for the updated milestone scope.
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

## Milestone 7 — Intra-image DCT block transform

This replaces the earlier two-image transplant slice. It changes quantized
DCT coefficients inside one supported JPEG, then uses the existing JPEG
encoder. It is a JPEG-domain edit, not entropy-stream corruption or a pixel
filter.

### Interaction and operation model

- [x] Combine Shuffle and Repeat Block under one **Block Transform** tool and
      contextual panel, retaining named modes: **Shuffle**, **Copy/Repeat**, and
      **Drag to transfer**. They remain distinct typed, replayable operation
      variants; this is a unified workflow, not an ambiguous single algorithm.
- [x] In Drag to transfer mode, click-drag a rectangular source region on the
      canvas. Snap its edges to the active component's visible 8×8 DCT-block grid;
      show the selected block rectangle and a destination ghost while dragging.
- [x] Drop to translate that exact-size region to a destination block-grid
      origin. Do not scale or interpolate. Default to copying; optionally offer
      swap as a separate explicit mode. Do not call a copy a move: moving would
      need a defined fill rule for vacated source blocks.
- [x] Reuse drag interaction for a one-block repeat source: drag within a
      visible source block, then drag from it to the first destination. Choose the
      number of repeated destinations; they continue along the dragged block-grid
      offset from an immutable source snapshot. Shuffle remains a seeded
      permutation of whole selected blocks within the selected region.
- [x] Offer whole-block transfer (DC + AC), DC-only transfer, and AC-only
      transfer. Whole-block mode copies all 64 quantized coefficients. AC-only
      preserves each destination block's DC; DC-only preserves its AC.
- [x] Show the target component, source and destination block extents, mode,
      seed where applicable, and that applying the operation re-encodes the JPEG.
- [x] Preview on the target image and commit as one undoable history operation.
      Undo/redo, parameter edits, and replay must start from the immutable original
      coefficient state, not from already encoded output.

### Compatibility and safety

- [x] Limit the first slice to the existing supported 8-bit baseline
      sequential Huffman JPEG subset (one interleaved scan; grayscale or three
      components).
- [x] Keep source and destination in the same component. Use visible component
      block coordinates and sampling-aware image overlays; never treat an 8×8
      block as an MCU or copy entropy-coded bytes.
- [x] Require source and destination rectangles to have identical block-grid
      dimensions and fit completely inside the selected component's visible block
      grid. Reject partial/out-of-grid regions with an actionable message.
- [x] Validate component identity, sampling factors, block geometry, and DQT
      assignment before execution. Within one component of one JPEG, DQT assignment
      is shared; do not add conversion or cross-component transfer in this slice.
- [x] Define overlap behavior explicitly: read all source coefficients from a
      snapshot before writing. Copy is allowed to overlap. Swap requires equal
      regions and uses two snapshots. Reject ambiguous repeated destinations.
- [x] Ensure component-grid edge padding is never exposed as a selectable
      visible block. Preserve original bytes and bound operation work.

### Tests and acceptance

- [x] Test full-block, DC-only, AC-only, copy, swap, repeat, and seeded
      shuffle coefficient results, including overlap and odd image edges.
- [x] Test invalid component, unequal region sizes, destination out of bounds,
      unsupported process, and malformed operation parameters.
- [x] Verify deterministic replay and exact undo/redo state; verify source
      JPEG bytes remain unchanged.
- [x] Encode representative grayscale, 4:2:0, 4:2:2, and 4:4:4 results and
      reopen them with an independent decoder.
- [x] Browser-check region snapping, drag ghost/drop, copy-vs-swap feedback,
      preview, and history controls.

Acceptance: a user can select a source block rectangle, transfer it to an
equal-size target on the same image, preview the re-encoded result, and undo or
redo it. Shuffle and Repeat remain available through the same Block Transform
tool. All coefficient semantics and compatibility failures are explicit.

Milestone 7 acceptance is complete. The browser smoke covered a rectangular
whole-block transfer, visible destination ghost, shuffle, repeat, coefficient
modes, swap, and undo/redo. The Export JPEG payload was reopened by independent
decoders; the original fixture bytes remained unchanged.

## Milestone 8 — Experimental entropy-coded scan corruption

This milestone deliberately edits the entropy-coded scan of a temporary
encoded JPEG. It is separate from the coefficient pipeline: the scan may
become undecodable, and the visible effect depends on decoder behavior.

### Interaction and pipeline

- [x] Add a **Scan Corrupt** tool/panel available only when the current
  coefficient result can be encoded by the supported baseline single-scan
  encoder. Label the target as entropy-coded scan bytes, not pixels, DCT
  blocks, MCUs, or arbitrary whole-file bytes.
- [x] Expose bounded deterministic controls: corruption mode (bit flip or
  byte replacement), count/strength, scan-relative range, and unsigned 32-bit
  seed. A scan-relative range is not a pixel location and must not imply a
  predictable visual location.
- [x] Run corruption after all coefficient/DQT operations and after normal
  encoding. The operation must work on a copy of the encoded output, never the
  imported source or the last saved export.
- [x] Keep the operation terminal in the history pipeline. Undo returns to the
  clean encoded coefficient result; redo and parameter edits replay from that
  clean result with the same seed. Permit explicitly stacked corruption
  stages only as byte-domain operations on the same bounded scan; do not run
  coefficient operations or silently re-encode after the first corruption.
- [x] Show distinct states for corruption complete, preview decoded, and
  preview decode failed. If decoding fails completely, retain and offer export
  of the corrupt bytes with a clear warning, while keeping the clean encoded
  preview available for comparison and undo.
- [x] Report seed, selected range, number of changed bytes/bits, preview status,
  and safe parser/decoder diagnostics. Do not describe partial decoder recovery
  as guaranteed.

### Structural checks and failure policy

- [x] Initially accept only a known output from the editor's supported
  baseline single-scan encoder. Parse and validate scan boundaries before
  changing bytes; reject unknown, malformed, multi-scan, or unsupported inputs.
- [x] Protect marker segments, SOI/EOI, restart markers, and byte-stuffing
  structure. Restrict changes to verified entropy data and ensure modified
  values cannot create new marker boundaries. Revalidate output bounds after
  corruption.
- [x] A structurally bounded stream that no longer decodes is an expected
  experiment, not an operation error: preserve its bytes, report decode
  failure, and do not silently substitute a pixel preview as the result.
- [x] Reject invalid ranges, non-finite/out-of-range parameters, excessive
  work, cancellation, and worker failures explicitly. Keep original bytes and
  the clean encoded result recoverable in every case.
- [x] Do not add general-purpose raw-byte editing or stream transplant to this
  milestone. Do not claim support for progressive, arithmetic-coded, or
  multi-scan JPEGs.

### Tests and acceptance

- [x] Test parser bounds, byte-stuffing/restart-marker protection, exact
  modified ranges, fixed output length, determinism, invalid parameters, and
  original-byte immutability.
- [ ] Include a fixture/result where independent decoding succeeds and one
  where corruption causes decode failure; in both cases verify encoded bytes
  remain available and undo restores the clean result.
- [x] Test repeated corruption stages replay in order and that coefficient
  edits cannot be placed after the terminal stream-corruption stage.
- [x] Browser-check visible preview failure, diagnostic, export, undo/redo,
  cancellation, and recovery to the clean encoded preview.

Acceptance: bounded, seeded corruption of a verified entropy-coded scan is
reproducible and undoable. Decoder failure, including total preview failure,
does not lose the experiment bytes or original JPEG and is reported as an
expected result rather than hidden.

### Verification status

- Implemented checks and unit tests are complete; the full `npm run check`
  passes.
- Browser smoke-tested a clean coefficient encode followed by scan corruption,
  parameter updates, stacked stages, terminal locking, undo/redo, cancellation,
  clean-preview recovery, and export availability. A preview decoder rejection
  was deliberately simulated to exercise the failure UI and confirm that the
  corrupt result remains exportable.
- The integrated browser harness does not expose native Blob download events.
  An actual corrupted stream that fails an independent decoder has not yet
  been captured and validated; the corresponding fixture/result acceptance
  item remains open.

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

## Milestone 10 — Static hosting and publication readiness

### Tasks

- [ ] Configure GitHub Pages to deploy the production build as a static site.
      Account for the repository-site base path so app assets, including the
      lazy-loaded JPEG codec, resolve correctly; keep image processing local
      and do not introduce an upload service.
- [ ] Measure and record the production payload baseline, including initial
      and lazy-loaded assets. Track size changes in CI or release checks, set
      an agreed size budget, and optimize only when measurements show it is
      needed.
- [ ] Confirm which contact details the user wants public and add only those
      approved details to the site before publication.
- [ ] Smoke-test the deployed GitHub Pages URL on the repository path, including
      loading the app and its assets and verifying the local JPEG workflow.

### Acceptance

- The production build deploys from GitHub Actions and loads at the GitHub Pages
  URL, with all app and codec assets resolving from the repository-site path.
- The production payload has a recorded baseline and repeatable size tracking;
  any size budget or optimization decision is based on measured output.
- The published site contains the user's explicitly approved contact details
  and does not expose unapproved personal information.
- JPEG processing remains client-side, with no image upload behavior added.

## Next issues — Milestones 7–8

1. Define Block Transform tool state and selection/drop interaction using the
   existing image-pixel selection and sampling-aware block geometry.
2. Implement and validate same-component coefficient copy/swap, DC/AC variants,
   repeat, and seeded shuffle as reversible typed operations.
3. Add a distinct encoded-stream history phase and worker boundary for seeded
   scan corruption; keep it terminal and preserve undecodable outputs.
4. Prove scan-boundary/marker protection and failure handling with fixtures
   before exposing the stream tool in the UI.
5. Defer two-image transplant, cross-component conversion, stream transplant,
   general raw-byte editing, and progressive/multi-scan support.

## Explicitly deferred

- Full progressive JPEG editing until scan model is designed.
- Arithmetic-coded JPEG unless a concrete codec and test plan support it.
- Arbitrary entropy stream transplant before bitstream-aware prototype passes.
- GPU acceleration before profiling.
- Mobile-first UI and Photoshop feature parity.
