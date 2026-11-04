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
