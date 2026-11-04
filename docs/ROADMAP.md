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

The read-only libjpeg-turbo C bridge, worker adapter, block inspector UI, and
coordinate mapping are implemented. The native bridge matched `jpegio` 0.2.8
for all 37 coefficient blocks across five synthetic fixtures. The Emscripten
4.0.23 WebAssembly module was built and exercised in a browser; the worker
successfully opened a baseline 4:2:0 fixture and displayed its selected 8×8
coefficient block. The generated JS and WASM are 33,281 and 105,948 bytes
respectively (10,657 and 41,405 bytes with gzip). See `docs/DECISIONS.md`
ADR-003 and `docs/DEVELOPMENT.md` for the local build procedure.

## Milestone 3 — Document model and operation history

### Tasks

- [ ] Define immutable original asset and editable document representations.
- [ ] Define versioned operation schema and registry.
- [ ] Implement operation stack, undo/redo, enable/disable, delete, and parameter editing.
- [ ] Add selection and mask representation.
- [ ] Add deterministic seeded random utility.
- [ ] Handle stale asynchronous preview results.

### Acceptance

- Operations can be replayed deterministically from the original document.
- Undo/redo restores the exact prior editable state.
- Reordering recomputes downstream operations and does not assume commutativity.
- Original bytes are always recoverable.

## Milestone 4 — First DCT editing vertical slice

### Tasks

- [ ] Add canvas navigation and block overlay.
- [ ] Add brush mask and block-aware selection.
- [ ] Implement one simple DCT operation (e.g. zero or scale selected coefficients).
- [ ] Add component and frequency-band selection.
- [ ] Preview by encoding/decoding through the selected codec.
- [ ] Export and reopen the resulting JPEG.

### Acceptance

- User can import a supported JPEG, paint a mask, apply a DCT operation, compare before/after, undo/redo, and export.
- Export opens in an independent decoder.
- UI explicitly identifies the result as re-encoded.

## Milestone 5 — Quantization and block operations

### Tasks

- [ ] Build 8×8 quantization matrix inspector/editor.
- [ ] Define and implement quantization edit semantics.
- [ ] Add controlled re-quantization/re-encoding.
- [ ] Add block duplicate/swap/repeat with compatibility checks.
- [ ] Add DC-only and AC-only operations.
- [ ] Add Y/Cb/Cr component controls.

### Acceptance

- Table edits never masquerade as direct recovery of discarded information.
- Coefficient/table behavior is documented and covered by tests.
- Incompatible block operations are rejected with actionable explanations.

## Milestone 6 — Two-image DCT transplant

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

## Milestone 7 — Experimental stream and byte lab

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

## Milestone 8 — Project persistence and polish

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

## First 10 issues to create

1. Scaffold TypeScript app, scripts, lint, typecheck, tests, CI.
2. Add JPEG fixture corpus and provenance manifest.
3. Implement safe marker scanner for supported JPEG subset.
4. Display parsed JPEG metadata in an inspector panel.
5. Add preview decode through a replaceable codec adapter.
6. Add block geometry model and coordinate mapping tests.
7. Spike coefficient access in candidate codecs.
8. Write codec decision record with benchmark and limitations.
9. Define document and operation TypeScript contracts.
10. Implement first deterministic coefficient operation in a test harness.

## Explicitly deferred

- Full progressive JPEG editing until scan model is designed.
- Arithmetic-coded JPEG unless a concrete codec and test plan support it.
- Arbitrary entropy stream transplant before bitstream-aware prototype passes.
- GPU acceleration before profiling.
- Mobile-first UI and Photoshop feature parity.
