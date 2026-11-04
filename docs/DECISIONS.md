# Decision records

## ADR-001: Browser-only application foundation

- **Status:** Accepted
- **Date:** 2026-11-05
- **Context:** Milestone 0 requires a runnable TypeScript application and a deployable frontend without image uploads. The architecture recommends a browser UI and isolates JPEG processing behind later modules.
- **Decision:** Use React + TypeScript + Vite. Treat Node.js as a development/build/test prerequisite only; production output is static browser assets. Use Node.js 20.19+ with 20.20.0 locally and Node.js 22 in CI. Pin direct dependencies and commit the npm lockfile.
- **Consequences:** Local development requires Node.js and npm, but deployments need no Node server or backend. React is included in the browser bundle. No JPEG codec or binary parser is chosen in this milestone.
- **Alternatives considered:** A framework-free TypeScript DOM application would reduce runtime bundle size but would depart from the architecture's recommended React UI. A server-backed implementation is outside the product's local-first privacy model.
