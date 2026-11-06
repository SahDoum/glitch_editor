# JPEG Glitch Experiment Catalog

This catalog describes what each implemented experiment changes, where it
acts in the JPEG workflow, and what its output means. A decoded browser
preview is not the original JPEG data. The original source bytes remain
unchanged; coefficient and DQT edits produce a newly encoded JPEG.

| Experiment               | JPEG representation changed                                                                    | Stage / effect                                                                                                                           | Re-encodes?                | Decode/export notes                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coefficient Glitch       | Quantized DCT coefficients in selected component blocks                                        | After coefficient decoding and before JPEG encoding; zero, scale, seeded randomize, DC offset, AC sign inversion, or frequency isolation | Yes                        | Uses the current 8-bit baseline sequential Huffman encoder subset. Invalid or extreme parameters may fail visibly. If encoding succeeds but browser preview decoding fails, the encoded result remains exportable. |
| Block Duplicate / Repeat | Whole quantized 8×8 DCT blocks within one component                                            | Copies the selected block to validated block-grid destinations before encoding                                                           | Yes                        | Operates on coefficient blocks, not MCU byte ranges or entropy-coded bytes. Destinations outside the component block grid are rejected.                                                                            |
| Block Shuffle            | Whole quantized DCT blocks, including DC and AC, selected by an image-space mask               | Seeded Fisher–Yates permutation within one component before encoding                                                                     | Yes                        | Selected blocks are permuted as a multiset; blocks outside the mask are unchanged. The mask is mapped using component sampling geometry.                                                                           |
| DQT Matrix Edit          | DQT values, with either coefficient reinterpretation or approximate coefficient requantization | Quantization-table handling before output encoding                                                                                       | Yes                        | Editing a DQT does not restore discarded detail. Reinterpretation and requantization are distinct. Neither operation is a direct marker-only patch.                                                                |
| Coefficient Recipe       | Ordered sequence of quantized coefficient operations and their seeds                           | Replays as one undoable history action, then the resulting coefficient state is encoded                                                  | Yes                        | Recipe steps are validated parameter data, not code. Each applied recipe captures the selected draft or saved-mask snapshot.                                                                                       |
| Save Named Mask          | Spatial mask in image-pixel coordinates                                                        | Document/history control surface; mapped to component blocks only when a consuming effect runs                                           | No                         | Saving a mask alone does not edit JPEG coefficients, pixels, markers, or source bytes.                                                                                                                             |
| Scan Corrupt             | Bounded bytes in the verified entropy-coded scan of the editor's clean encoded result          | Dedicated terminal worker stage after coefficient/DQT replay and normal JPEG encoding                                                    | No after the normal encode | Seeded bit flips or byte replacements; protects marker/restart/stuffing structure and output length. The result can be undecodable but remains exportable; undo restores the clean encoded result.                 |

## Planned experiments

These are roadmap items, not currently implemented capabilities.

| Experiment                        | JPEG representation changed                             | Stage / effect                                                                                                                                                       | Re-encodes? | Planned constraints                                                                                           |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| Block Transform: copy/swap/repeat | Quantized DCT coefficients in same-component 8×8 blocks | Snapshot a source region, then copy/swap whole blocks or only DC/AC to an equal-size destination; repeat copies one source block; shuffle permutes a selected region | Yes         | Component/block-grid validated; source and target are regions of one JPEG. Never MCU or entropy-byte copying. |

## Explicitly not implemented here

- Stream transplant.
- Raw-byte corruption or marker-segment rewriting.
- Progressive, arithmetic-coded, or multi-scan JPEG editing.
- MCU byte copying, video-style inter-frame prediction, or pixel-only
  substitutes presented as JPEG-domain glitches.
- Cross-image block transplant and image mixing. These remain deferred and
  require separate compatibility checks and reversible coefficient-domain
  operation designs.

The supported coefficient path remains limited to 8-bit baseline sequential
Huffman JPEG with grayscale or three-component frames and one interleaved
scan. See [the roadmap](./ROADMAP.md), [architecture](./ARCHITECTURE.md), and
[decision records](./DECISIONS.md) for capability and workflow details. The
Scan Corrupt is not a coefficient edit; a failed decode is an expected
experiment and must not discard the encoded experiment. The current controls
allow 1–256 changes per stage, at most eight stages, scan-relative normalized
ranges, and an unsigned 32-bit seed. The worker is limited to the supported
baseline single-scan encoder output, verifies unchanged marker boundaries and
file length, and does not promise that the corrupted scan decodes.
