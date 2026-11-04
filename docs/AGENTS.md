# Instructions for AI coding agents

These instructions apply to coding agents working in this repository. If a task conflicts with this file, stop and ask for clarification rather than silently choosing a different architecture.

## 1. Product and engineering principles

- Build a browser-based, local-first, non-destructive JPEG glitch editor.
- The product edits JPEG structures, not merely decoded pixels. Keep pixel operations and JPEG-domain operations explicitly distinguished.
- Preserve the exact original JPEG bytes. Never overwrite or discard the original asset.
- Prefer small, reviewable changes over broad rewrites.
- Do not claim a feature works until its tests and acceptance criteria pass.

## 2. Critical JPEG terminology and correctness rules

Use these terms precisely:
- pixel/sample;
- 8×8 DCT block;
- quantized DCT coefficient;
- MCU (Minimum Coded Unit);
- component and sampling factors;
- DQT quantization table;
- marker segment;
- entropy-coded scan;
- re-encoding;
- raw-byte corruption;
- stream transplant.

Never conflate:
- pixel-space coordinates with DCT block coordinates, MCU coordinates, or byte/bit offsets;
- DCT coefficient editing with entropy-stream editing;
- MCU manipulation with arbitrary byte copying;
- changing a DQT marker with re-quantizing existing coefficients;
- a preview decode with the original JPEG data.

JPEG has no inter-frame prediction chain like video. Do not explain or implement JPEG corruption as if it were video datamoshing.

## 3. Architecture boundaries

- UI components must not manipulate binary offsets, marker parsing, or codec internals directly.
- Keep `ui`, `application`, `document`, `jpeg`, and `operations` boundaries intact.
- Route JPEG work through the JPEG facade/adapter.
- Route edits through typed operations and the operation registry.
- Keep entropy-stream and raw-byte tools isolated from the ordinary coefficient-editing pipeline.
- Do not introduce hidden pixel-only fallbacks for JPEG-domain operations.

## 4. Change discipline

Before coding:
1. Read `PRODUCT.md`, `docs/ARCHITECTURE.md`, the relevant spec, and existing code.
2. Summarize the requested behavior and affected modules.
3. Identify assumptions, unsupported JPEG cases, and data-loss risks.
4. Propose a small implementation plan and tests.
5. Ask before changing public interfaces, core data representations, dependencies, or supported JPEG processes.

During coding:
- Implement only the requested scope.
- Preserve existing conventions and avoid unrelated refactors.
- Use strict TypeScript types; avoid `any` unless justified and localized.
- Validate all external input and operation parameters.
- Make random operations deterministic when a seed is supplied.
- Handle cancellation, stale worker responses, and errors explicitly.
- Do not silently swallow parser/decoder/encoder errors.

After coding:
- Run relevant tests, type checking, linting, and build where available.
- Add tests for every behavior change and regression.
- Report exact commands run and their outcomes.
- List known limitations and cases not tested.
- Update docs/specs when behavior or interfaces change.

## 5. JPEG safety and export rules

- Never mutate the original imported byte array in place.
- Preserve original bytes for reset and original export.
- Validate marker lengths, segment boundaries, scan boundaries, and bounds before reading.
- Treat malformed or adversarial files as untrusted input; avoid unbounded allocation and pathological loops.
- Do not assume every JPEG is baseline sequential Huffman.
- Check component identifiers, sampling factors, block geometry, quantization-table assignments, scan organization, precision, and coding mode before transplant operations.
- A raw entropy-stream transplant must account for Huffman tables, scan parameters, bit alignment, DC predictor state, restart intervals, byte stuffing, and markers. If the implementation does not handle these, reject the operation or label it as an explicitly destructive byte experiment.
- Raw-byte operations may make a file undecodable. Keep them reversible and sandboxed; never overwrite source bytes.
- Clearly label re-encoding and generation loss.

## 6. Testing requirements

- Add unit tests for parsing, coordinate mapping, coefficient operations, masks, and serialization.
- Include small known-good JPEG fixtures and malformed fixtures.
- Test baseline/progressive or other processes only when the capability is explicitly claimed.
- Validate exported JPEGs by reopening them with an independent decoder where practical.
- Use golden fixtures for deterministic visual or coefficient-level outcomes.
- Include edge cases: odd image dimensions, grayscale, common chroma subsampling modes, restart markers, multiple scans, missing/truncated segments, and unsupported processes.
- Tests must not rely only on checking that an output file exists.

## 7. Dependency policy

- Do not add a dependency without explaining why it is needed, its license, maintenance status, bundle/runtime implications, and alternatives.
- Do not replace the JPEG codec or parser without an explicit architecture decision.
- Pin or constrain versions consistently with the repository's package manager.

## 8. User experience requirements

- Keep the original visible/comparable at all times.
- Explain the operation's target domain and consequences.
- Show whether a result is approximate, stale, re-encoded, or potentially undecodable.
- Provide useful errors, not raw stack traces as the only feedback.
- Support undo/redo and reset wherever the operation model allows it.
- Keep image processing local; do not add network upload behavior without explicit product approval.

## 9. Definition of done

A task is done only when:
- acceptance criteria are met;
- tests/typecheck/build pass, or failures are explicitly reported;
- errors and unsupported inputs are handled;
- docs are updated if needed;
- no unrelated files or generated artifacts are accidentally included;
- the final report states changed files, tests run, and remaining limitations.

## 10. Required response format for an implementation task

At completion, report:
1. **Implemented:** concise behavior summary.
2. **Files changed:** paths and purpose.
3. **Verification:** exact commands and pass/fail.
4. **Limitations:** unsupported cases and known risks.
5. **Next step:** one concrete follow-up, if needed.
