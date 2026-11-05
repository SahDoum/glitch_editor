# First Glitch Lab

This catalog describes JPEG-domain experiments in the current editor. The
goal is to make the visual consequences of changing JPEG coding data
observable, repeatable, and comparable with the untouched original. A
standards-valid or browser-decodable JPEG is a useful outcome, but not the
only measure of an experiment.

All current operations start from the immutable imported JPEG and replay in
history order. The source bytes are never edited in place. The current codec
path re-encodes a new JPEG; it does not edit the original entropy-coded scan
or copy arbitrary byte ranges. If the browser cannot preview-decode an
encoded result, the editor reports that outcome and keeps the result available
for export.

## Operation catalog

### Coefficient operations

These operations change **quantized DCT coefficients** in selected 8×8 DCT
blocks. The mask is painted in image-pixel coordinates, then mapped to the
visible block grid for the selected component. Chroma sampling can make a
component block cover more image pixels than a luma block.

| Operation           | Parameters                                                     | Expected visual behavior                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero                | Component, DC/AC domain, AC frequency band, mask               | Zeroing AC removes spatial-frequency energy and may flatten texture or edges. Zeroing DC removes block-average variation and may produce large tonal changes.                       |
| Scale               | Same controls plus multiplier `-8…8`                           | Magnitudes above 1 strengthen selected frequencies; values between 0 and 1 attenuate them; negative values flip coefficient signs and can create ringing or structural changes.     |
| Randomize           | Same controls plus amplitude `1…2047` and unsigned 32-bit seed | Replaces each selected quantized coefficient with a deterministic signed integer in the requested range. The seed and parameters are stored in history.                             |
| DC offset           | DC domain, mask, signed offset `-2047…2047`                    | Adds a constant to each selected block's DC coefficient. Results depend on neighboring DC differences and can be rejected by the baseline encoder if they exceed its coding limits. |
| AC inversion        | AC domain, low/mid/high/all band, mask                         | Negates selected AC coefficient signs while retaining magnitudes and DC. This can reverse local basis patterns and produce edge/ringing changes.                                    |
| Frequency isolation | AC domain, low/mid/high band, mask                             | Retains only the selected AC band and zeros all other AC frequencies in selected blocks; DC remains unchanged.                                                                      |
| AC manipulation     | AC domain, low/mid/high/all band, mask, mode                   | Applies zero, scale, randomize, inversion, or frequency isolation to AC only; the DC coefficient is left untouched. Bands use natural-order `u + v`: low 1–2, mid 3–5, high 6–14.   |

Coefficient edits clamp output values to baseline coefficient ranges before
encoding. This avoids signed-integer overflow, but does not guarantee every
combination will be accepted by libjpeg-turbo's baseline encoder.

### Block duplicate / repeat

Copies one selected quantized DCT block within the same JPEG component:

- **Source X/Y:** coordinates in that component's visible 8×8 block grid.
- **Offset X/Y:** signed displacement in component blocks.
- **Copies:** number of repeated destinations, 1–256.
- Each destination is `source + n × offset`, for `n = 1…copies`.
- Every destination must be inside the selected component grid. Invalid
  repeats fail with an explanation instead of being clipped silently.

This copies a coefficient block, not an MCU and not entropy-coded bytes. The
source and destination belong to the same component, so their component
geometry and quantization-table assignment match.

### Block permutation

Block permutation shuffles whole quantized 8×8 DCT blocks within the selected
component and mask:

- The unit is all 64 coefficients, including DC.
- A block is selected at 50% or greater mask coverage. Rectangle coverage is
  computed by area; brush coverage uses a deterministic 8×8 sample grid per
  visible block and selects at 32 or more covered samples.
- All selected blocks participate in one Fisher–Yates shuffle, regardless of
  distance. Blocks outside the mask are unchanged.
- The unsigned 32-bit seed is stored in history. The same coefficient input,
  mask, and seed reproduce the same permutation.
- Every selected block appears exactly once in the shuffled positions; the
  operation neither drops nor duplicates blocks. DC moves together with AC.

This is a permutation of coefficient blocks inside one component, not an MCU
or entropy-stream operation. Brush-edge coverage is sampled, not an exact
continuous-area calculation.

### DQT matrix edits

The inspector and editor show a table as 64 values in **natural 8×8
coefficient order**. JPEG marker DQT entries use zigzag order internally; the
parser converts them for display, and the codec handles output serialization.

| Control                | Choices / limits                                                          | Expected effect                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table                  | An existing DQT table assigned to at least one component                  | Editing a shared table affects all components assigned to it.                                                                                      |
| Cell values            | Integer `1…255`                                                           | Smaller values retain more of the current coefficient range; larger values quantize more coarsely.                                                 |
| Pattern                | Manual, flat, horizontal stripes, vertical stripes, radial, seeded random | Replaces the proposed matrix with a structured or repeatable pattern.                                                                              |
| Semantics: reinterpret | Keep quantized coefficients; write the edited DQT                         | Changes how retained integers decode. It does not recompute or recover discarded detail.                                                           |
| Semantics: requantize  | `round(oldCoefficient × oldQuantizer / newQuantizer)`                     | Approximately preserves the dequantized value represented by retained coefficients, then encodes with the new DQT. Prior information loss remains. |

Requantization rounds symmetrically around zero, then clamps coefficients to
the current baseline limits (DC ±2047, AC ±1023). A table edit is a versioned
operation, so undo, redo, disabling, and reordering replay the sequence from
the original JPEG.

## Component controls

The operation panel selects one component by index and shows its JPEG
component ID and sampling factors. IDs 1, 2, and 3 are labelled “likely Y,”
“likely Cb,” and “likely Cr” because those are common conventions; component
IDs alone do not prove color meaning. The parsed component order and sampling
factors are authoritative. Grayscale files expose one Gray component.

## Example experiments

### Remove mid-frequency texture in a painted region

1. Import a supported JPEG and paint a mask over the region.
2. Select the desired component, **AC coefficients**, **Zero selected
   coefficients**, and the **mid** frequency band.
3. Apply the operation, then compare the encoded preview with the original.

The operation targets AC coefficients with natural-order `u + v` from 3 to 5. It does not modify DC or decoded pixels directly.

### Build a deterministic chroma coefficient repeat

1. Select the component commonly used as Cb or Cr, checking its ID and
   sampling factors.
2. Set a source block coordinate, an in-bounds offset, and the copy count.
3. Apply **Duplicate / repeat block** and compare the repeated texture and
   block boundaries in the preview.

The operation copies one block's 64 quantized coefficients within that
component. It does not alter luma blocks or copy a whole MCU.

### Explore a high-contrast DQT pattern

1. Select a DQT table and generate **horizontal stripes**.
2. Apply it first as **reinterpret**, then undo and apply the same matrix as
   **requantize**.
3. Compare the two previews and inspect the resulting DQT matrix and history.

The matrix is identical in both runs; the coefficient semantics differ.
Neither run can restore information already discarded in the imported JPEG.

### Reproduce a random coefficient experiment

1. Choose **Randomize**, select DC or AC, and set a frequency band if using
   AC.
2. Enter an amplitude and unsigned 32-bit seed, for example `42`.
3. Apply, undo, and apply again with the same mask and values.

The resulting coefficient edits are deterministic for the same original,
component, mask, parameters, and seed. Changing the seed changes the pattern.

### Shuffle blocks without losing coefficient data

1. Select one component and create a rectangular or brush mask.
2. Set a fixed unsigned 32-bit seed and apply **Permute blocks in mask**.
3. Repeat from the same source, component, mask, and seed to reproduce the
   same shuffle; compare with a different seed for a new arrangement.

The whole 64-coefficient blocks move together, so DC and AC stay paired. A
block outside the mask remains in place. The current tool shuffles globally
within the mask; local, row, column, and small-region modes are not included.

## Experiment log and verification results

The following are automated representation-level checks, not claims about
every browser decoder or photograph:

| Check                     | Expected observation                                                                                                                                        | Recorded result                                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DQT natural-order mapping | A marker table containing values 1…64 in zigzag order exposes natural-order prefix `1, 2, 6, 7, 15, 16, 28, 29, 3, 5`.                                      | Verified by `tests/unit/jpeg-inspect.test.ts`.                                                                                                                                                                                                                               |
| DQT patterns              | All patterns produce 64 legal values in 1…255; the same random seed reproduces the same matrix.                                                             | Verified by `tests/unit/jpeg-glitch.test.ts`.                                                                                                                                                                                                                                |
| Block repeat bounds       | Repeats inside the component grid are accepted; a destination outside the grid is rejected.                                                                 | Verified by `tests/unit/jpeg-glitch.test.ts` and `tests/unit/jpeg-document.test.ts`.                                                                                                                                                                                         |
| Block permutation scope   | Rectangle masks include blocks at 50% area; brush masks use 64-point coverage sampling. The operation has an explicit seeded history record.                | Verified by `tests/unit/block-geometry.test.ts`, `tests/unit/jpeg-glitch.test.ts`, and `tests/unit/jpeg-document.test.ts`.                                                                                                                                                   |
| History/source safety     | Coefficient and DQT operations are replayable through undo/redo; original bytes remain unchanged.                                                           | Verified by `tests/unit/jpeg-document.test.ts`.                                                                                                                                                                                                                              |
| Native bridge semantics   | Zero, scale, randomize, DC shift, AC inversion, frequency isolation, repeat, permutation, and both DQT semantics match their coefficient-level definitions. | Native bridge check passed against libjpeg-turbo 3.0.4; deterministic seed, permutation multiset/out-of-mask preservation, and DQT values were asserted.                                                                                                                     |
| Independent JPEG decoding | Encoded permutation, DQT reinterpretation, and DQT requantization outputs decode and retain 16×16 dimensions.                                               | `djpeg` decoded all three outputs; ImageMagick `identify` reported 16×16 sRGB for each.                                                                                                                                                                                      |
| Encoded visual output     | Inspect actual results across browser decoders and photographic inputs; record any decode failures and retain exported bytes.                               | The synthetic 16×16 fixture produced a browser-rendered re-encoded preview after block repeat, AC inversion, frequency isolation, block permutation, and radial DQT edit.                                                                                                    |
| WASM bridge runtime       | Build and exercise the expanded C bridge with Emscripten 4.0.23; independently inspect the emitted coefficient arrays and DQT values.                       | Built with Emscripten 4.0.23. The exported `_coefficient_permute_blocks` symbol is present in the generated JS/WASM; all five listed operations completed in the browser without UI errors.                                                                                  |
| Browser UI smoke          | Import a synthetic JPEG, reach the Glitch Lab controls, and apply an operation.                                                                             | Production preview imported `synthetic-color-420.jpg`; operation history showed Block duplicate/repeat, AC inversion, frequency isolation, block permutation, and DQT edit as APPLIED. Exported output was captured from the browser as 667 bytes with JPEG SOI/EOI markers. |

When recording a manual experiment, include the input fixture or photo
description (never publish an unlicensed photo), operation parameters and
seed, browser/decoder, whether preview decoding succeeded, and a short note
about the visible effect. Do not treat a successful decode by one decoder as
proof that all decoders will render identically.

## Capability boundary

The current coefficient reader and encoder support only 8-bit baseline
sequential Huffman JPEG with one interleaved scan and either one grayscale or
three components. Progressive, arithmetic-coded, multi-scan, non-8-bit, and
other unsupported inputs remain rejected. The current operation set does not
include block swap, multi-block region duplication, local/row/column
permutation modes, MCU edits, two-image transplant, entropy-stream corruption,
or raw-byte corruption; those require separate compatibility or
experimental-sandbox work.
