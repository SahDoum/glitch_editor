# JPEG Glitch Editor

A browser-based, non-destructive workspace for JPEG experiments. Image work is designed to stay in the browser; this project does not include a backend or image-upload service.

The publication build loads Google Tag Manager on page open, which can send
visit data to Google and run tags configured by the container owner. JPEG
processing remains local; the application itself does not send image files
to analytics. An unconfigured build does not load the container.
See [publication setup](./docs/DEVELOPMENT.md#publication-and-payload).

## Development

```bash
nvm install
nvm use
npm ci
npm run dev
```

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the Node.js requirement, verification commands, error/logging conventions, and fixture provenance.

The coefficient prototype uses libjpeg-turbo WebAssembly. This software is based in part on the work of the Independent JPEG Group.

## Project documents

- [Product specification](./PRODUCT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Current interface and experiment-brush paradigm](./docs/INTERFACE.md)
- [UI proposals and implementation checkpoints](./docs/UX_SIMPLIFICATION_PROPOSAL.md)
- [Roadmap](./docs/ROADMAP.md)
- [JPEG test strategy](./docs/JPEG_TEST_STRATEGY.md)
- [Glitch experiments catalog](./GLITCH_EXPERIMENTS.md)
