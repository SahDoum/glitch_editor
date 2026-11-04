# Decision records

## ADR-001: Browser-only application foundation

- **Status:** Accepted
- **Date:** 2026-11-05
- **Context:** Milestone 0 requires a runnable TypeScript application and a deployable frontend without image uploads. The architecture recommends a browser UI and isolates JPEG processing behind later modules.
- **Decision:** Use React + TypeScript + Vite. Treat Node.js as a development/build/test prerequisite only; production output is static browser assets. Use Node.js 20.19+ with 20.20.0 locally and Node.js 22 in CI. Pin direct dependencies and commit the npm lockfile.
- **Consequences:** Local development requires Node.js and npm, but deployments need no Node server or backend. React is included in the browser bundle. No JPEG codec or binary parser is chosen in this milestone.
- **Alternatives considered:** A framework-free TypeScript DOM application would reduce runtime bundle size but would depart from the architecture's recommended React UI. A server-backed implementation is outside the product's local-first privacy model.

## ADR-002: Milestone 1 JPEG inspector capability

- **Status:** Accepted
- **Date:** 2026-11-05
- **Context:** The product specification grouped coefficient inspection with the first JPEG-inspection milestone, while the implementation roadmap defers codec evaluation and coefficient access until Milestone 2. No production JPEG codec has been selected.
- **Decision:** Milestone 1 inspects marker/frame/scan metadata for 8-bit baseline sequential Huffman JPEGs with one interleaved scan and one or three components. Decode the preview using the browser's image decoder, keeping the pixel preview separate from the original bytes and parsed JPEG structure. Defer coefficient-array inspection until the codec evaluation milestone. Limit input files to 50 MiB, image dimensions to 40 megapixels, and marker entries to 10,000; run marker parsing in a cancellable Web Worker.
- **Consequences:** No codec or parser dependency is introduced. Progressive, arithmetic-coded, non-8-bit, multi-scan, and over-limit JPEGs are rejected with a user-facing diagnostic. A successful browser preview is not treated as coefficient access or proof that the JPEG structure is supported by this application.
- **Alternatives considered:** Select and integrate a coefficient-capable codec during Milestone 1. This would conflict with the roadmap's codec evaluation gate and require a dependency/architecture decision before the evaluation work.

## ADR-003: Milestone 2 coefficient-access prototype

- **Status:** Accepted for prototype; not a production codec decision
- **Date:** 2026-11-05
- **Context:** The selected JPEG subset needs access to quantized DCT coefficients. Browser pixel decoders do not expose those coefficients, and coefficient access must remain separate from the decoded preview and original bytes.
- **Decision:** Use `@ai-ecoverse/wasm-libjpeg-turbo@3.2.0-2` as a build-time static library (upstream libjpeg-turbo 3.2.0). Link a small C bridge that calls `jpeg_read_coefficients()` and reads one selected 8×8 `JBLOCK` through libjpeg's virtual-array access API. Run decoding in a dedicated Web Worker. The prototype is read-only and supports only files that pass the existing 8-bit baseline sequential Huffman, grayscale/three-component, single interleaved scan inspector.
- **Evaluation:** The selected package is 320,295 bytes compressed and 1,463,157 bytes unpacked; those numbers describe its npm package, not the final browser module. It was published 2026-11-02 and packages upstream libjpeg-turbo 3.2.0 (the upstream project publishes newer 3.x releases independently). The package contains Emscripten WebAssembly static archives and headers, no ready-made coefficient JavaScript API. Its declared license is IJG, BSD-3-Clause, and Zlib; comply with the upstream notices and include the IJG attribution in product documentation. The bridge was built with Emscripten 4.0.23 without SIMD. Generated assets are 33,281-byte JavaScript and 105,948-byte WebAssembly files; gzip sizes are 10,657 and 41,405 bytes. The browser downloads the codec lazily when coefficient inspection is requested.
- **Native reference check:** The bridge compiled against local libjpeg-turbo 3.0.4 and matched `jpegio` 0.2.8 on all 37 coefficient blocks across five synthetic fixtures (4:2:0, odd-dimension 4:2:0, 4:2:2, 4:4:4, and grayscale). This validates coefficient ordering and block reads against an independent reader, but does not replace building and testing the selected 3.2.0 WebAssembly archive.
- **Alternatives considered:** `@crossbind/port-jpegturbo-wasm` 2.0.0-beta.67 exposes `jpeg_read_coefficients()` through generated bindings but returns an opaque coefficient-array handle; inspecting a block still needs an additional binding. Its package is 1,267,770 bytes compressed and 5,338,713 bytes unpacked. `@cornerstonejs/codec-libjpeg-turbo-8bit` 1.2.8 is a ready-made browser module but its demonstrated API only decodes pixels, not quantized coefficients (637,114 bytes compressed; 2,686,773 bytes unpacked). The smaller static-library package plus a narrow bridge is the more direct coefficient path and adds no production JavaScript codec dependency.
- **Browser verification:** The generated WebAssembly module loaded in the production preview and read/displayed one selected 8×8 block from the synthetic baseline 4:2:0 fixture in a Web Worker. No browser console errors or user-facing errors remained after exporting `HEAPU8` for the worker bridge.
- **Consequences and limits:** This is a prototype, not a production codec or encoder choice. Coefficient access temporarily retains libjpeg's coefficient arrays in WASM memory and rejects images requiring more than 128 MiB of coefficient storage. It does not write coefficients, encode JPEGs, support progressive/arithmetic/multi-scan/non-8-bit JPEGs, or replace the browser pixel preview. The imported source bytes are copied before transfer and remain immutable. Broader browser/process compatibility and independent-reference validation of the generated WASM artifact remain future work.

## ADR-004: Milestone 3 document and operation model

- **Status:** Accepted
- **Date:** 2026-11-05
- **Context:** The editor needs non-destructive document state and repeatable operation history before coefficient-writing and encoding are available. The current coefficient bridge is read-only and exposes one selected block.
- **Decision:** Store original JPEG bytes in a private `OriginalAsset` buffer and expose only defensive copies. Represent the editable document as immutable revisioned snapshots. Keep selection in image-pixel coordinates and spatial masks as a versioned spatial representation. Register typed operations by exact type/version; replay enabled operations from the initial editable representation after edits, toggles, deletion, or reordering. Store immutable frames for undo/redo and use monotonic document revisions to reject stale previews. Version the serialized operation stack independently from each operation definition. A supplied unsigned 32-bit seed drives deterministic random execution.
- **Initial operation:** The UI registers a spatial-mask operation so mask history, parameter editing, enable/disable, reordering, undo/redo, and reset are demonstrable. This operation changes only the editable spatial-mask state; it does not edit JPEG coefficients or pixels.
- **Consequences and limits:** Unknown schema or operation versions are rejected; no migration path is claimed yet. The preview coordinator drops results superseded by a newer request or document revision, but this milestone has no coefficient preview worker to connect. DCT operations, JPEG re-encoding, brush-mask rasterization, and project-file persistence remain outside this milestone. Original bytes are recoverable at all times.
