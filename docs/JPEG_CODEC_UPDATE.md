
# Task: Add Progressive JPEG Import and Export Support

## Objective

Extend the existing JPEG Glitch Editor to support Progressive JPEG files in addition to the currently supported Baseline Sequential JPEG files.

The implementation must reuse the existing libjpeg-turbo WebAssembly codec and coefficient-processing architecture wherever possible.

Do not rewrite the JPEG engine or introduce a separate coefficient representation for Progressive JPEG unless the existing architecture demonstrably requires it.

The goal is to support:

- Importing Progressive JPEG files.
- Reading their complete quantized DCT coefficient arrays.
- Applying existing JPEG-domain operations.
- Exporting results as either Baseline Sequential or Progressive JPEG.
- Preserving the existing Baseline workflow and behavior.

Progressive JPEG support must be implemented at the codec boundary, not by converting images to RGB and applying pixel-level filters.

---

## Phase 1 — Inspect the Existing Implementation

Before changing code, inspect:

1. The libjpeg-turbo WASM C bridge.
2. JPEG import and inspection logic.
3. JPEG process detection and capability checks.
4. Coefficient decoding and encoding.
5. `JpegEngine` interface and its implementations.
6. Worker request/response protocol.
7. `CoefficientDocument` representation.
8. Existing JPEG fixtures and integration tests.
9. Scan Corrupt implementation and its assumptions about entropy scan boundaries.

Identify exactly where Progressive JPEG is currently rejected.

Determine whether the limitation comes from:

- JPEG parser restrictions.
- Codec bridge restrictions.
- Coefficient decoding.
- Coefficient encoding.
- Application-level validation.
- Worker protocol or data representation.

Do not assume the limitation is entirely in the parser.

Produce a short implementation assessment before making changes.

---

## Phase 2 — Verify libjpeg-turbo Capabilities

Verify the capabilities of the exact libjpeg-turbo version and WASM build used by this project.

Investigate these APIs:

- `jpeg_read_header()`
- `jpeg_read_coefficients()`
- `jpeg_write_coefficients()`
- `jpeg_copy_critical_parameters()`
- `jpeg_simple_progression()`

Verify that the current WASM build exposes the required functionality.

Important:

- Progressive JPEG uses SOF2 (`FF C2`).
- Baseline Sequential JPEG uses SOF0 (`FF C0`).
- Progressive JPEG distributes coefficient information across multiple scans.
- `jpeg_read_coefficients()` should provide the complete coefficient arrays after processing the progressive input.
- `jpeg_simple_progression()` configures progressive output scans.
- `jpeg_write_coefficients()` allows writing modified coefficient arrays without RGB decoding and recomputing DCT.

Do not implement progressive scan decoding manually unless the existing codec cannot provide the required coefficient API.

Document any codec limitations discovered during this phase.

---

## Phase 3 — Progressive JPEG Import

Extend the existing import pipeline to accept supported Progressive JPEG files.

Requirements:

1. Recognize SOF2.
2. Allow the codec to process all progressive scans.
3. Obtain complete quantized DCT coefficient arrays.
4. Populate the existing `CoefficientDocument` representation.
5. Preserve component geometry, sampling factors, quantization tables and component/table assignments.
6. Preserve useful scan metadata in `JpegStructure`.
7. Keep unsupported JPEG processes explicitly rejected.

Do not silently treat an incomplete or partially decoded coefficient representation as complete.

The application must distinguish:

- Baseline Sequential JPEG.
- Progressive JPEG.
- Other unsupported JPEG processes.

---

## Phase 4 — Progressive JPEG Export

Add an output encoding mode.

Introduce:

```ts
type JpegOutputMode =
  | "baseline"
  | "progressive";

interface EncodeOptions {
  mode: JpegOutputMode;
}
```

Extend the existing `JpegEngine.encodeCoefficients()` contract to accept `EncodeOptions`.

Requirements:

### Baseline output

Preserve existing behavior.

### Progressive output

Use libjpeg-turbo progressive encoding.

Investigate the correct lifecycle and ordering of:

- Compressor initialization.
- Critical parameter copying.
- Progressive scan script configuration.
- Coefficient writing.
- Compressor finalization.

Use `jpeg_simple_progression()` as the initial progressive scan configuration.

Do not implement custom scan scripts in this task.

The output must contain SOF2 and multiple scans.

Preserve dimensions, component geometry and quantization semantics.

Do not introduce an RGB round trip.

---

## Phase 5 — Output Mode Independence

The output mode must be independent of the source JPEG process.

Support these workflows:

| Input | Output | Expected |
|---|---|---|
| Baseline | Baseline | Supported |
| Baseline | Progressive | Supported |
| Progressive | Baseline | Supported |
| Progressive | Progressive | Supported |

Existing operations must work with both input types without modification to their JPEG-domain semantics.

The same operation history applied to the same coefficient representation must not produce different results merely because the output mode differs.

---

## Phase 6 — Scan Corrupt Compatibility

The existing Scan Corrupt implementation assumes verified single-scan entropy ranges.

Do not silently extend this implementation to Progressive JPEG.

For this task:

- Keep Scan Corrupt restricted to its currently supported single-scan input/output assumptions.
- Explicitly reject unsupported multi-scan inputs.
- Ensure the error message explains that Progressive JPEG scan corruption is not yet supported.
- Do not alter existing Baseline Scan Corrupt behavior.

Progressive multi-scan corruption will be a separate future task.

---

## Phase 7 — Tests

Add fixtures and tests covering:

### Import

- Baseline JPEG.
- Progressive JPEG.
- Grayscale Progressive JPEG.
- Three-component Progressive JPEG.
- Unsupported JPEG processes.

### Export

- Baseline → Baseline.
- Baseline → Progressive.
- Progressive → Baseline.
- Progressive → Progressive.

### Coefficient integrity

For an unmodified import/export round trip:

- Compare quantized coefficient arrays before and after.
- Compare component dimensions and sampling factors.
- Compare quantization table values and assignments.
- Check image dimensions.

Account for legitimate metadata changes and marker regeneration.

Do not require byte-for-byte equality between input and output.

### Operations

Test representative existing operations on Progressive inputs:

- DC modification.
- AC modification.
- Frequency isolation.
- Component-specific operation.
- Block transformation.
- DQT editing.

Verify that operations remain deterministic and replayable.

### Output validation

Verify:

- Correct SOF marker.
- Correct scan structure.
- Successful decoding by libjpeg-turbo.
- Successful decoding by an independent JPEG decoder, where available.
- Browser preview behavior.

Do not treat successful encoding alone as proof of correct Progressive JPEG output.

---

## Phase 8 — Documentation

Update:

- `ARCHITECTURE.md`
- `PRODUCT.md`
- `JPEG_TEST_STRATEGY.md`
- `INTERFACE.md`, only if user-facing import/export behavior changes.

Document:

- Supported JPEG processes.
- Progressive import/export behavior.
- Output mode selection.
- Remaining limitations.
- Scan Corrupt restrictions.

Do not claim support for arbitrary JPEG processes or custom progressive scan scripts.

---

## Engineering Constraints

1. Preserve the immutable original JPEG bytes.
2. Preserve replay-from-original operation semantics.
3. Keep JPEG implementation details inside the JPEG facade and codec adapter.
4. Do not add pixel-level fallbacks.
5. Do not introduce new runtime dependencies without justification.
6. Keep existing Baseline functionality and tests passing.
7. Use structured errors for unsupported inputs and codec failures.
8. Do not silently discard metadata or change operation semantics.
9. Keep expensive codec operations inside workers.
10. Avoid unrelated refactoring.

## Definition of Done

The task is complete when:

- Progressive JPEG files can be imported.
- Complete coefficient arrays are available to the existing operation engine.
- Existing JPEG-domain operations work on Progressive inputs.
- Users can export as Baseline or Progressive JPEG.
- All four input/output combinations pass integration tests.
- Existing Baseline workflows remain unchanged.
- Scan Corrupt explicitly retains its current limitations.
- Documentation accurately describes the implemented capabilities.

## Important Working Rule

Start by inspecting the actual code and reporting the implementation plan.

Do not assume that the architecture document perfectly reflects the current implementation.

Do not implement all phases blindly. Verify the codec capabilities first, then proceed in small, testable steps.

If the current libjpeg-turbo WASM build lacks a required API, report the exact missing capability and propose the smallest necessary build or bridge change before introducing an alternative codec.


