# Development foundation

## Runtime model

The editor is a static browser application. JPEG processing is intended to run locally in the browser; there is no backend, upload endpoint, or image-processing service in this repository. Node.js is used only by the development, test, lint, and build tools. A production build is static content in `dist/` and can be served by any static host.

Use Node.js 20.19+ or 22.12+ and npm 10.8.2 or newer. The repository's `.nvmrc` selects Node.js 20.20.0. CI uses Node.js 22.

## Commands

```bash
nvm install             # Install the version pinned in .nvmrc
nvm use                 # Select the pinned Node.js for this terminal
npm ci                 # Reproducible install from package-lock.json
npm run dev             # Local Vite development server
npm run format          # Format application source, configuration, and new docs
npm run format:check    # Verify formatting without editing files
npm run lint            # ESLint
npm run typecheck       # TypeScript, strict mode
npm test                # Unit tests, once
npm run test:watch      # Unit tests in watch mode
npm run build           # Typecheck and production build
npm run size            # Report sizes of the existing production build
npm run preview         # Serve the production build locally
npm run check            # Run formatting, lint, typecheck, tests, and build
```

## Error and logging policy

Expected failures caused by user input, malformed files, unsupported formats, or processing use the discriminated `Result<T, AppError>` type in `src/shared/result.ts`. `AppError` has a stable code and a concise message suitable for user feedback. Unexpected programming errors may throw and must be handled at an application boundary; do not silently convert them into success-shaped defaults.

The logger in `src/shared/logging.ts` accepts only an allowlisted event name and error code. Do not log JPEG bytes, image metadata, file names, user input, or raw stack traces. Show actionable safe messages in the UI rather than relying on developer-console output.

## Dependencies

The selected stack follows `docs/ARCHITECTURE.md`:

- React and React DOM are MIT-licensed, actively maintained browser runtime dependencies used for the UI. Their code is included in the production bundle. A framework-free DOM UI was the alternative; React was selected to match the architecture's UI recommendation and support the planned editor surfaces.
- Vite and its React plugin are MIT-licensed, actively maintained development/build tools. They are not runtime services; Vite emits static browser assets.
- TypeScript is Apache-2.0 licensed. ESLint, typescript-eslint, the React Hooks plugin, Prettier, and Vitest are MIT-licensed, actively maintained development-only tools for type checking, linting, formatting, and tests. None is shipped as a browser runtime dependency.
- No JPEG parser, codec, WASM module, telemetry, analytics, or upload dependency was included in Milestone 0. The coefficient codec choice and current editing scope are recorded in ADR-003 and ADR-005.

Direct dependency versions are pinned in `package.json` and the complete dependency graph is locked in `package-lock.json`. The `minimatch` override pins the patched 11.0.1 release throughout the development toolchain. Reassess bundle/runtime cost and JPEG codec licensing before introducing any image-processing dependency.

## Publication and payload

The CI workflow builds with the repository name as the GitHub Pages base path,
then publishes `dist/` on pushes to `main` after verification. In GitHub
repository settings, select **Pages > Build and deployment > Source: GitHub
Actions**, and permit the `github-pages` deployment environment. The expected
repository-site URL is `https://sahdoum.github.io/glitch_editor/`. The
workflow must actually run successfully and the deployed site must be tested
before publication is considered complete. Forks use their own repository
name; user/organization root Pages sites and custom base paths need a workflow
change.

The Pages workflow sets `VITE_GTM_CONTAINER_ID=GTM-K6BK97GW`, the public
Google Tag Manager container ID provided by the owner. A local build has no
container unless the variable is supplied; an invalid ID fails the build.
The standard GTM initialization event and asynchronous container script run
on page open, as requested by the owner. The welcome screen discloses this.
To count visits, configure and publish a Google tag in that GTM container
using a GA4 web stream's `G-...` measurement ID and an All Pages trigger.
The container's current configuration is unknown. Confirm the deployed site's
page view in GTM preview and GA4 Realtime; loading the container alone does
not prove visits were recorded.

GTM can run arbitrary tags configured by its administrators. The application
does not send image files, project data, filenames, or edit events to GTM,
but container tags can access the page and collect visit/device/network data,
including URLs and referrers. Review every tag, automatic event and GA4
setting, and restrict container access to preserve the local-first privacy
promise; avoid sending sensitive URLs or user data. Review applicable privacy
and consent requirements before activation. No consent management is
implemented. Unlike the prior direct GA4 integration, the app cannot enforce
page URL or referrer filtering on tags managed by GTM.

Reproduce the repository-path build and payload report:

```bash
npm run build -- --base=/glitch_editor/
npm run size
npm run preview -- --host 127.0.0.1 --base=/glitch_editor/
```

Open the `/glitch_editor/` path, import a synthetic fixture from
`tests/fixtures/`, inspect coefficients, apply an edit and verify export.
Check the browser network panel for the worker and both codec files under the
same base path and for unexpected image uploads. Repeat on the actual Pages
URL. The size report lists every static build file, grouping HTML and directly
referenced assets as initial and the rest as deferred. It reports raw bytes
and independently gzip-compressed estimates, not actual browser downloads:
workers and codecs load on demand, hosting compression may differ, and the
remote Google script is excluded. CI publishes the report in each job summary.
No size budget has been agreed; the measurements are a baseline, not a
release gate.

The coefficient reader and editor link the pinned
`@ai-ecoverse/wasm-libjpeg-turbo` static WebAssembly library at build time. It
is a development dependency; the browser receives the generated coefficient
read/write bridge module. Regenerating that module requires Emscripten 4.0.23
(`emcc`), which is not installed by the normal project install. Run
`npm run build:jpeg-codec`; the command writes
`public/codec/libjpeg-coefficients.js` and
`public/codec/libjpeg-coefficients.wasm`. Include these generated assets in
production output. If the codec is missing or fails, coefficient inspection
and re-encoding report an error rather than falling back to pixel-only edits.
The bridge uses libjpeg-turbo under its IJG/BSD-3-Clause/Zlib licenses; product
documentation must include: “This software is based in part on the work of the
Independent JPEG Group.”

### Rebuilding the WebAssembly bridge

The bridge is compiled locally from
`src/jpeg/codec/coefficient-bridge.c`, using headers and the static
`libjpeg.a` shipped in the pinned npm development dependency. Emscripten is an
external build tool and is not installed by `npm ci`; use version 4.0.23 to
match the generated module. First check whether the compiler is already
available:

```bash
emcc --version
```

On this computer, Emscripten 4.0.23 is available in the Copilot session
directory. Locate its environment script, then activate it without moving the
SDK or installing it globally:

```bash
find "$HOME/.copilot/session-state" -path '*/emsdk/emsdk_env.sh' -print
source "/path/to/emsdk/emsdk_env.sh"
emcc --version
cd /path/to/glitch_editor
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
npm run build:jpeg-codec
```

Replace `/path/to/emsdk` with the SDK directory found by `find`, and
`/path/to/glitch_editor` with the repository directory. The SDK path is in
session storage and may change; if it is no longer available, use the general
setup below or set `EMCC` to another Emscripten 4.0.23 compiler.

To install the official Emscripten SDK in a temporary directory when no
compatible compiler is available, clone the SDK, install and activate version
4.0.23, then source its environment. This does not use Homebrew or install
Emscripten globally:

```bash
git clone https://github.com/emscripten-core/emsdk.git /tmp/jpeg-glitch-emsdk
cd /tmp/jpeg-glitch-emsdk
./emsdk install 4.0.23
./emsdk activate 4.0.23
source ./emsdk_env.sh
cd /path/to/glitch_editor
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
npm ci
npm run build:jpeg-codec
```

Replace `/path/to/glitch_editor` with the repository path. The Node path above
matches this machine's nvm installation; on another machine, activate the
repository's Node version with nvm (or use another supported Node.js 20.19+ or
22.12+ installation) before running npm.

The official SDK installer uses a prebuilt toolchain when available for the
host platform. Availability can vary: if `emsdk install 4.0.23` reports that
it must build LLVM or another large toolchain component from source, stop
rather than starting an unbounded build. The successful local build used
Emscripten 4.0.23 from the SDK in Copilot session storage on 2026-11-06; its
session-specific absolute path is intentionally not recorded here. The earlier
failed `/tmp/jpeg-glitch-emsdk` install was removed. If the SDK cannot provide
a prebuilt toolchain in another environment, use a compatible machine or CI
runner with adequate disk space. If Emscripten is already installed and
`emcc` is on `PATH`, the SDK installation steps can be skipped; `npm ci` is
needed only if project dependencies are not installed. Alternatively, select
a specific compiler without changing `PATH`:

```bash
EMCC=/absolute/path/to/emsdk/upstream/emscripten/emcc npm run build:jpeg-codec
```

The script links the C bridge to the packaged static library and emits a
modularized ES-module factory for browser and worker use. It disables the
virtual filesystem, exports the bridge functions and `HEAPU8`, and enables
bounded growable WASM memory (64 MiB initial, 512 MiB maximum). Emscripten
writes the JavaScript glue at
`public/codec/libjpeg-coefficients.js` and its sibling WASM binary at
`public/codec/libjpeg-coefficients.wasm`. The build script exits with an
actionable error if the npm library is missing or `emcc` cannot be run.

The codec artifacts are checked in, but `npm run build` does not rebuild them:
it only copies the current files from `public/codec/` into `dist/`. Whenever
the C bridge adds or changes an exported function, rebuild both artifacts with
`npm run build:jpeg-codec` and commit the updated JavaScript and WASM together.
Otherwise the TypeScript declarations and worker can expect an API that the
older WASM binary does not export; native C tests or a successful production
build alone do not catch that mismatch.

After rebuilding, confirm both assets exist and run the production build so
Vite copies them into `dist/`:

```bash
ls -lh public/codec/libjpeg-coefficients.js public/codec/libjpeg-coefficients.wasm
npm run build
ls -lh dist/codec/libjpeg-coefficients.js dist/codec/libjpeg-coefficients.wasm
```

Commit regenerated codec assets when the bridge or codec changes; they are
required by the browser app and are not generated by the normal Vite build.
The exact compiler arguments and exported C functions are maintained in
`scripts/build-coefficient-codec.mjs`.

If a rebuild cannot be performed on the current host, do not claim the new
WASM API is browser-ready. Keep the existing generated files unchanged, use a
toolchain-capable machine to regenerate them, and verify the resulting browser
workflow there. At minimum, exercise each newly added operation in the browser
and confirm that preview/export succeeds; `npm run check` does not test the
runtime exports inside the WASM binary.

The current re-encoder accepts only 8-bit baseline sequential Huffman JPEGs
with one interleaved scan and grayscale or three components. Input/output
JPEGs are limited to 50 MiB, coefficient storage to 256 MiB, and worker glitch
processing is bounded. The WASM heap is capped at 512 MiB, so browsers/devices
with less available memory may still report allocation failure. The edited export is a new JPEG; saved APP/COM markers
are copied except APP0 and APP14, and metadata preservation is not guaranteed.
The browser preview may fail even when encoded bytes are retained for export.
See ADR-005 and ADR-006 for codec limits, experiment semantics, and DQT modes.

Milestone 8 uses a separate entropy-corruption worker after the clean
coefficient encoder. It accepts only the resulting supported baseline
single-scan JPEG, preserves all structural markers, restart markers,
byte-stuffing pairs, and byte length, and caps each stage at 256 changed bytes,
the stack at eight stages, and total replay input at 100 MiB. A worker is
terminated on cancellation or when a newer coefficient result supersedes it.
The output can fail browser preview decoding and remains exportable; the clean
encoded preview remains separate. After corruption, the same pinned
libjpeg-turbo WASM codec decodes scanlines and reports rows read, decoder
warnings, and whether it completed the JPEG stream. This is not an independent
decoder and does not guarantee that other applications will recover the same
image. These checks do not add support for progressive, arithmetic-coded,
multi-scan, or arbitrary imported-byte edits.

The Milestone 8 browser smoke test exercised corruption after a coefficient
encode, parameter updates, stacked stages, terminal-stage locking, undo/redo,
and cancellation. It also simulated a browser preview-decoder rejection and
confirmed that the warning, clean-preview comparison, and export availability
remain visible. The small synthetic fixtures and a 128 × 128 generated image
still decoded after the tested corruption runs; an independently rejected
corrupted output has not yet been captured. The integrated browser harness
does not emit native Blob download events, so export availability was checked
in the UI but the downloaded artifact was not independently inspected.

The scanline diagnostic was also exercised against valid grayscale and 4:2:0
fixtures and tail-corrupted copies using host libjpeg-turbo. Both valid fixtures
reported every row without warnings; the corrupted copies still returned all
rows but emitted decoder warnings. The browser worker showed the same
full-rows-with-warning state. Other decoders may truncate or recover those
bytes differently; this diagnostic is not an independent cross-decoder
comparison.

## Fixture corpus

`tests/fixtures/` contains tiny, programmatically generated JPEG patterns only. They are synthetic test data, not photographs. The fixture manifest records generation provenance, dimensions, expected process, license, and SHA-256 digest. The source patterns are original geometric/color fields and are released under CC0-1.0; ImageMagick is only the generation tool and is not a runtime dependency.
