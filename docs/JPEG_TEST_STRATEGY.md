# JPEG Test Strategy

**Purpose:** verify that the editor manipulates JPEG structures correctly, produces valid exports where promised, and never loses the original asset.

## 1. Testing principles

1. Test the representation being edited. Pixel screenshots alone cannot prove coefficient correctness.
2. Use independent decoders/inspectors for cross-validation.
3. Keep exact original bytes and assert they remain unchanged.
4. Separate valid-output tests from intentionally destructive glitch tests.
5. Every supported JPEG process must have representative fixtures.
6. Record fixture provenance and licensing.
7. Make randomized operations reproducible with fixed seeds.

## 2. Test layers

### Unit tests

- Marker parsing and segment-length validation.
- Frame/component/table parsing.
- Sampling-factor and MCU geometry calculations.
- Block and coefficient coordinate mapping.
- Quantization matrix indexing and transformations.
- Mask-to-block/MCU coverage.
- DCT operation math and parameter validation.
- Seeded random number generation.
- Operation serialization, replay, undo/redo.
- Worker message validation and stale-result rejection.

### Integration tests

- Import → inspect → preview.
- Import → coefficient decode → operation → encode → independent decode.
- Mask → DCT operation → undo → redo.
- Quantization edit → documented re-quantization/encoding path.
- Two-image transplant with compatible and incompatible inputs.
- Save project → reopen → replay operations.

### Golden/reference tests

- Compare parsed metadata against known expected values.
- Compare coefficient arrays against a trusted reference tool/library.
- Compare encoded output properties, not necessarily byte-for-byte output, unless encoder determinism is guaranteed.
- Use golden previews with tolerances where codec differences are expected.
- Store expected diagnostics for malformed and unsupported files.

### End-to-end browser tests

- Drag/drop and file-picker import.
- Canvas zoom/pan and overlays.
- Tool parameter editing and preview.
- Undo/redo and operation stack controls.
- Export download and reopen.
- No network request carrying image bytes.

## 3. Fixture corpus

Maintain a small, documented fixture set. Include at least:

| Fixture                          | Why it exists                         |
| -------------------------------- | ------------------------------------- |
| Baseline sequential, color 4:2:0 | Common camera/photo case              |
| Baseline sequential, color 4:4:4 | No chroma subsampling                 |
| Grayscale JPEG                   | Single-component path                 |
| 4:2:2 JPEG                       | Different MCU geometry                |
| 4:4:4 JPEG                       | One block per component sampling unit |
| Odd width/height                 | Edge MCU and padding behavior         |
| Very small image                 | Boundary conditions                   |
| High-detail image                | Coefficient distribution              |
| Progressive JPEG                 | Capability boundary and later support |
| Restart markers                  | Scan segmentation and recovery        |
| Truncated segment                | Parser robustness                     |
| Corrupt entropy data             | Decoder failure handling              |
| Missing/invalid table reference  | Validation and error handling         |

Each fixture should have a manifest entry containing:

- filename and digest;
- source/provenance and license;
- expected JPEG process;
- dimensions and precision;
- components and sampling factors;
- restart interval and scan count where applicable;
- whether the current product version claims support.

### Milestone 1 capability

The current inspector accepts 8-bit baseline sequential Huffman JPEGs with
one interleaved scan and either one grayscale or three components. It parses
marker boundaries, byte-stuffed entropy data, and restart markers, but does
not entropy-decode or expose quantized DCT coefficients. The pixel preview is
decoded separately by the browser and must not be used as evidence of
coefficient correctness. Progressive, arithmetic-coded, non-8-bit, and
multiple-scan files are unsupported and must fail visibly. The import limits
are 50 MiB per JPEG file, 40 megapixels per frame, and 10,000 marker entries.
Parser tests cover the pixel and marker limits; import tests verify oversized
files are rejected before reading.

The Milestone 2 coefficient prototype reads only 8-bit baseline sequential
Huffman JPEGs with one interleaved scan and one or three components. Its
libjpeg-turbo WebAssembly bridge rejects coefficient arrays exceeding 128 MiB.
It reads quantized coefficients in natural 8×8 block order; it does not edit or
re-encode them. Coordinate mapping is tested for grayscale and 4:2:0, 4:2:2,
and 4:4:4 sampling, including odd image dimensions and the distinction between
visible coefficient blocks and MCU padding. The native C bridge's coefficient
blocks were cross-checked against `jpegio` 0.2.8 on the synthetic fixture set;
the generated WebAssembly module still requires its own runtime validation.

Do not use unlicensed photographs in a public test corpus. Tiny synthetic images are preferred for deterministic tests.

## 4. Independent validation

Use at least one independent JPEG implementation to:

- decode exported files;
- inspect dimensions and color components;
- confirm the output is structurally valid;
- compare coefficient behavior when possible.

The production codec must not be its own only oracle. A successful decode by one implementation is useful but does not prove semantic correctness.

## 5. JPEG parser tests

Test:

- SOI and EOI handling;
- marker fill bytes and marker boundaries;
- segment lengths including minimum and truncated lengths;
- APPn/COM skipping and preservation policy;
- DQT and DHT parsing;
- SOF frame parsing;
- SOS scan parsing;
- restart markers;
- byte stuffing in entropy-coded data;
- multiple scans and progressive markers as capability permits;
- unknown markers and malformed ordering.

Fuzz parser inputs with bounded sizes and assert:

- no crash;
- no out-of-bounds read;
- no unbounded allocation;
- structured error or supported parse result.

## 6. Coefficient and geometry tests

For each supported sampling mode:

- verify component block dimensions;
- verify MCU dimensions and blocks per MCU;
- test edge/padded blocks for odd dimensions;
- map image-space points and masks to intersecting blocks;
- test DCT coefficient index `(u, v)` mapping to the 8×8 array;
- preserve DC/AC distinction.

Use small synthetic images where expected coefficients can be reasoned about and cross-check with an independent coefficient reader.

## 7. Quantization tests

Verify:

- 64 table entries and valid value ranges for the chosen JPEG process;
- correct zigzag/natural-order mapping at parser/encoder boundaries;
- table selectors and component assignments;
- documented semantics for edits to existing coefficients;
- no claim that DQT marker replacement recovers discarded data;
- output decodes and its actual quantization tables match the intended export.

Test extreme but legal values and reject invalid values.

## 8. Operation engine tests

For every operation:

- parameter schema rejects invalid inputs;
- operation does not mutate original bytes;
- same seed + same input + same parameters yields same output;
- undo then redo restores the same result;
- toggling or reordering recomputes downstream state correctly;
- masks and component restrictions are respected;
- operation version can be migrated or rejected explicitly.

Test operation failure midway and verify document remains recoverable.

## 9. Export tests

For normal coefficient/re-encoding workflows:

- exported bytes begin/end with expected JPEG structure;
- independent decoder opens the file;
- dimensions/components match expected policy;
- output tables and scan organization match the selected encoder settings;
- export status accurately says re-encoded or stream-preserved.

For raw-byte/entropy experiments:

- output may be invalid by design;
- original bytes remain byte-for-byte identical;
- failure is isolated and diagnostics are recorded;
- no automatic replacement of source or last known-good export occurs.

## 10. Performance and robustness

Track:

- import and parse time by file size;
- coefficient decode/encode time;
- preview latency;
- peak memory use;
- worker cancellation responsiveness.

Set initial budgets after measuring representative fixtures on target browsers and hardware. Avoid arbitrary performance promises before a baseline exists.

## 11. Release gates

A milestone is not complete unless:

- all unit and integration tests pass;
- supported fixture matrix passes;
- independent decoder validation passes for valid exports;
- malformed fixtures fail safely;
- original-byte immutability tests pass;
- documented unsupported cases match actual behavior;
- manual browser smoke test is recorded.

## 12. Suggested test commands

Adapt to the package manager and scripts actually chosen. Do not claim these commands exist until configured.

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```
