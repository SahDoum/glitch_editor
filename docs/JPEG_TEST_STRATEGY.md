# JPEG Test Strategy

**Purpose:** verify that the editor changes the intended JPEG representation,
records reproducible visual experiments, reports decode/conformance outcomes
honestly, and never loses the original asset. Standards-valid output is tested
where promised, but is not the sole success criterion for glitch operations.

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
- Zero, scale, randomize, DC offset, AC inversion, frequency isolation,
  block copy/swap/repeat/permutation, DC/AC transfer, and DQT pattern
  semantics.
- Seeded random number generation.
- Operation serialization, replay, undo/redo.
- Worker message validation and stale-result rejection.
- Workspace tool-group order, active-tool transitions, shared selection
  persistence, independent block-selection state, panel collapse state, and
  continuous brush overlay path rendering.
- Image-pixel click to component DCT-block mapping for common sampling modes
  and odd visible image edges.
- Block-repeat source and destination drags map to the selected component grid;
  invalid source regions and destination vectors are rejected.

Milestone 3 additionally verifies defensive original-byte reads, image-pixel
selection and mask bounds, deterministic seeded replay, operation stack
serialization/version rejection, ordered recomputation, enable/disable,
parameter edits, delete, undo/redo, and stale preview discard.

### Integration tests

- Import → inspect → preview.
- Import → coefficient decode → operation → encode → independent decode.
- Same-image block-region selection → copy/swap or DC/AC transfer → encode →
  independent decode.
- Mask → DCT operation → undo → redo.
- Quantization edit → documented re-quantization/encoding path.
- Scan corruption → successful or failed preview decode → retained export →
  scanline/warning diagnostic → undo to clean encoded result.
- Save project → reopen → replay operations.
- Save `.jpglitch` → verify embedded source digest and exact bytes → reopen in
  the editor → verify operation order, enabled state, mask snapshots, draft
  mask, and deterministic replay.
- Reject unsupported project schema versions, malformed Base64, source
  length/hash mismatches, unsafe file names, excessive project size, and
  operation records that do not validate against the imported JPEG.

### Golden/reference tests

- Compare parsed metadata against known expected values.
- Compare coefficient arrays against a trusted reference tool/library.
- Compare encoded output properties, not necessarily byte-for-byte output, unless encoder determinism is guaranteed.
- Use golden previews with tolerances where codec differences are expected.
- Store expected diagnostics for malformed and unsupported files.
- For entropy-corrupted JPEGs, record the decoder identity, rows decoded vs.
  expected, warning count/categories, and finish status. Treat these as
  decoder-specific observations, not cross-application guarantees.

### End-to-end browser tests

- Drag/drop and file-picker import.
- Canvas zoom/pan and overlays.
- Tool-group activation, selection persistence between Brush and Select,
  Inspector block highlight/coefficient readout, and independent section and
  whole-panel collapse.
- Tool parameter editing and preview.
- Block Transform copy/repeat source drag, destination vector, repeated preview,
  and undo/redo.
- Undo/redo and operation stack controls.
- Export download and reopen.
- Project save/open and the Ctrl/⌘ keyboard shortcuts; verify that shortcuts
  do not intercept typing in form controls.
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
one interleaved scan, and 8-bit progressive (SOF2) Huffman JPEGs with any
number of scans (spectral selection and successive approximation parameters are
validated and recorded per scan), each with either one grayscale or three
components. It parses
marker boundaries, byte-stuffed entropy data, and restart markers, but does
not entropy-decode or expose quantized DCT coefficients. The pixel preview is
decoded separately by the browser and must not be used as evidence of
coefficient correctness. Arithmetic-coded, non-8-bit, other SOF processes, and
multiple-scan sequential files are unsupported and must fail visibly. The import limits
are 50 MiB per JPEG file, 40 megapixels per frame, and 10,000 marker entries.
Parser tests cover the pixel and marker limits; import tests verify oversized
files are rejected before reading.

The libjpeg-turbo coefficient bridge accepts 8-bit baseline sequential
Huffman JPEGs with one interleaved scan and 8-bit progressive Huffman JPEGs,
with one or three components. Progressive files that libjpeg had to repair are
rejected. Output can be baseline or progressive
(`jpeg_simple_progression()`), independent of the source process.
`tests/unit/progressive-jpeg.test.ts` loads the shipped WASM bridge in Node
(`tests/helpers/codec-harness.ts`) and covers all four input/output
combinations (coefficient, geometry, sampling and quantization-table equality;
SOF marker and scan count), operations on progressive inputs (DC, AC,
frequency isolation, component-specific, DQT) compared against baseline
replay, and pixel equality via the independent `djpeg` decoder when installed
(skipped silently otherwise). Progressive fixtures are lossless `jpegtran
-progressive` transcodes of the baseline fixtures. Browser preview of
progressive output is exercised only manually; it is not part of the automated
suite. It rejects
coefficient arrays exceeding 256 MiB. Coefficients are read in natural 8×8
block order; image-space masks map to visible component blocks, distinct from
MCU padding. Coordinate mapping and mask coverage are tested for grayscale
and 4:2:0, 4:2:2, and 4:4:4 sampling, including odd image dimensions. The
native reader's coefficients were cross-checked against `jpegio` 0.2.8 on the
synthetic fixture set.

Milestone 4 adds the initial masked AC-zero operation. Milestone 5 extends the
same replay-from-original path with zero/scale/seeded randomize for DC or AC,
DC offset, AC inversion, frequency isolation, in-component block duplicate
and repeat, seeded block permutation, component-specific editing, and DQT
matrix edits. Block permutation applies seeded Fisher–Yates to whole quantized
8×8 blocks including DC, with the selected block multiset preserved. A
rectangle includes a block at 50% coverage; brush coverage uses deterministic
8×8 spatial samples and the same 50% threshold. DQT reinterpretation retains
quantized coefficients; requantization uses
`round(oldCoefficient × oldQuantizer / newQuantizer)` with baseline coefficient
range clamping. Neither recovers information lost before import. Every edit
creates new encoded bytes without mutating the source. The UI can export those
bytes when browser preview decoding fails. Arithmetic-coded,
sequential multi-scan, and other unsupported processes remain rejected.
Scan Corrupt additionally rejects Progressive JPEG input. Saved APP/COM
markers are copied except APP0 and APP14, so metadata preservation is not
guaranteed.

Native bridge exports for grayscale, 4:2:0 (including odd dimensions), 4:2:2,
and 4:4:4 synthetic fixtures were reopened by ImageMagick and macOS `sips`.
The generated Emscripten 4.0.23 module was loaded in a browser and exercised
through import, brush mask, DCT operation, re-encoded preview, and undo/redo.
For Milestone 7, the browser smoke check also covered seeded shuffle, a
rectangular whole-block transfer with a visible destination ghost, DC-only,
AC-only, swap, and repeat operations. Undo/redo restored and replayed the
transfer, and the original fixture digest remained unchanged. The bytes behind
the app's Export JPEG link were reopened by both ImageMagick and macOS `sips`.
The integrated browser harness did not emit Playwright download events even
for a visible direct Blob URL link, so its native download UI is not observable
in this harness; the exact application export payload was validated instead.

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
- test block-permutation mask thresholding at 50%, including component-specific
  block footprint and odd visible edges.

Use small synthetic images where expected coefficients can be reasoned about and cross-check with an independent coefficient reader.

## 7. Quantization tests

Verify:

- 64 table entries and valid value ranges for the chosen JPEG process;
- correct zigzag/natural-order mapping at parser/encoder boundaries;
- table selectors and component assignments;
- both documented semantics for edits to existing coefficients;
- no claim that DQT marker replacement recovers discarded data;
- parsed output tables match the edited natural-order matrix when the codec
  bridge can be exercised;
- seeded matrix patterns match exactly.

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
- block permutation moves whole 64-coefficient blocks, includes DC, preserves
  the selected block multiset, and is deterministic for the same seed.
- AC inversion changes only selected AC signs; frequency isolation clears
  out-of-band AC coefficients and preserves DC.

Test operation failure midway and verify document remains recoverable.

## 9. Export tests

For normal coefficient/re-encoding workflows:

- exported bytes begin/end with expected JPEG structure;
- independent decoder opens the file;
- dimensions/components match expected policy;
- output tables and scan organization match the selected encoder settings;
- export status accurately says re-encoded or stream-preserved.

For glitch experiments:

- compare coefficient arrays or DQT tables to prove the requested
  representation changed;
- verify repeated seeds reproduce identical coefficient edits;
- keep browser preview-decode failure separate from encode failure and retain
  the encoded bytes for export;
- record decoder-specific outcomes instead of treating decode failure as
  evidence that no useful experiment occurred.

For raw-byte/entropy experiments:

- output may be invalid by design;
- original bytes remain byte-for-byte identical;
- failure is isolated and diagnostics are recorded;
- no automatic replacement of source or last known-good export occurs.

For Scan Corrupt, separately test structural safety and decode outcome. Reject
unverified scan boundaries and unsupported processes; protect marker,
restart-marker, and byte-stuffing structure. A structurally bounded stream
that a decoder cannot render is still a valid experiment artifact: retain its
bytes for export, expose decode failure explicitly, and keep the clean encoded
result available for comparison and undo. Do not treat decoder failure as an
instruction to fall back to pixel manipulation. Unit coverage includes
determinism, exact scan-relative mutation bounds, fixed output length, marker
protection, parameter validation, immutable input, stacked replay and
terminal-history undo/redo. Browser preview failure/export/undo and independent
decoder outcomes remain manual integration release checks.

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
