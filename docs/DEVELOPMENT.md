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
- No JPEG parser, codec, WASM module, telemetry, analytics, or upload dependency is included in Milestone 0. Codec selection remains deferred to the documented evaluation milestone.

Direct dependency versions are pinned in `package.json` and the complete dependency graph is locked in `package-lock.json`. The `minimatch` override pins the patched 11.0.1 release throughout the development toolchain. Reassess bundle/runtime cost and JPEG codec licensing before introducing any image-processing dependency.

## Fixture corpus

`tests/fixtures/` contains tiny, programmatically generated JPEG patterns only. They are synthetic test data, not photographs. The fixture manifest records generation provenance, dimensions, expected process, license, and SHA-256 digest. The source patterns are original geometric/color fields and are released under CC0-1.0; ImageMagick is only the generation tool and is not a runtime dependency.
