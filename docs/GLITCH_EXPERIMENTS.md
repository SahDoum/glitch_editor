# JPEG Glitch Experiment Catalog

This catalog describes what each implemented experiment changes, where it
acts in the JPEG workflow, and what its output means. A decoded browser
preview is not the original JPEG data. The original source bytes remain
unchanged; coefficient and DQT edits produce a newly encoded JPEG.

| Experiment               | JPEG representation changed                                                                    | Stage / effect                                                                                                                           | Re-encodes? | Decode/export notes                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coefficient Glitch       | Quantized DCT coefficients in selected component blocks                                        | After coefficient decoding and before JPEG encoding; zero, scale, seeded randomize, DC offset, AC sign inversion, or frequency isolation | Yes         | Uses the current 8-bit baseline sequential Huffman encoder subset. Invalid or extreme parameters may fail visibly. If encoding succeeds but browser preview decoding fails, the encoded result remains exportable. |
| Block Duplicate / Repeat | Whole quantized 8×8 DCT blocks within one component                                            | Copies the selected block to validated block-grid destinations before encoding                                                           | Yes         | Operates on coefficient blocks, not MCU byte ranges or entropy-coded bytes. Destinations outside the component block grid are rejected.                                                                            |
| Block Shuffle            | Whole quantized DCT blocks, including DC and AC, selected by an image-space mask                | Seeded Fisher–Yates permutation within one component before encoding                                                                     | Yes         | Selected blocks are permuted as a multiset; blocks outside the mask are unchanged. The mask is mapped using component sampling geometry.                                                                           |
| DQT Matrix Edit          | DQT values, with either coefficient reinterpretation or approximate coefficient requantization | Quantization-table handling before output encoding                                                                                       | Yes         | Editing a DQT does not restore discarded detail. Reinterpretation and requantization are distinct. Neither operation is a direct marker-only patch.                                                                |
| Coefficient Recipe       | Ordered sequence of quantized coefficient operations and their seeds                           | Replays as one undoable history action, then the resulting coefficient state is encoded                                                  | Yes         | Recipe steps are validated parameter data, not code. Each applied recipe captures the selected draft or saved-mask snapshot.                                                                                       |
| Save Named Mask          | Spatial mask in image-pixel coordinates                                                        | Document/history control surface; mapped to component blocks only when a consuming effect runs                                           | No          | Saving a mask alone does not edit JPEG coefficients, pixels, markers, or source bytes.                                                                                                                             |

## Explicitly not implemented here

- Entropy-coded scan corruption or stream transplant.
- Raw-byte corruption or marker-segment rewriting.
- Progressive, arithmetic-coded, or multi-scan JPEG editing.
- MCU byte copying, video-style inter-frame prediction, or pixel-only
  substitutes presented as JPEG-domain glitches.
- Cross-image block transplant, within-image block displacement, and image
  mixing. These require separate compatibility checks and reversible
  coefficient-domain operation designs.

The supported coefficient path remains limited to 8-bit baseline sequential
Huffman JPEG with grayscale or three-component frames and one interleaved
scan. See [the roadmap](./ROADMAP.md), [architecture](./ARCHITECTURE.md), and
[decision records](./DECISIONS.md) for capability and workflow details.
