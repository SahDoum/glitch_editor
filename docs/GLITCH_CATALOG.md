# JPEG Glitch Editor — Glitch Catalog

**Purpose:** Research catalog of visual effects that may be produced by manipulating JPEG data.

**Status:** Research document. Entries are not necessarily implemented or verified.

## 1. How to read this catalog

The catalog distinguishes three different things:

- **Artifact:** what the viewer sees in the image.
- **Mechanism:** what happens inside the JPEG representation.
- **Operation:** what the editor actually does to produce or investigate the result.

These are not interchangeable.

For example, a horizontal smear is an artifact. Changing DC differences in an entropy-coded scan is one possible mechanism. A tool that modifies DC coefficients and re-encodes the image is an operation.

One artifact may have several possible mechanisms. One operation may produce different artifacts depending on the source image and parameters.

## 2. Research status

Use these statuses consistently:

- `UNRESEARCHED` — idea recorded, not investigated.
- `HYPOTHESIS` — a proposed mechanism or expected visual result.
- `EXPERIMENTING` — tests are in progress.
- `VERIFIED` — the effect and its mechanism have been reproduced and documented.
- `IMPLEMENTED` — a user-facing operation exists in the application.
- `REJECTED` — the proposed mechanism did not produce the expected result or was technically incorrect.
- `DEFERRED` — potentially useful, but not currently a priority.

`IMPLEMENTED` does not automatically mean that every visual result associated with the operation is guaranteed. Record the tested conditions and limitations.

## 3. Classical JPEG artifacts

### 3.1 Blocking

**Artifact:** Visible square boundaries, usually aligned to the 8×8 DCT block grid.

**Possible mechanisms:**
- coarse quantization;
- strong differences between neighboring block reconstructions;
- repeated encoding at low quality;
- coefficient manipulation that increases discontinuities across block boundaries.

**Research questions:**
- Can the editor create controllable blocking without simply lowering overall JPEG quality?
- Can the effect be localized to a mask?
- Which coefficient bands contribute most to the visible block boundaries?

**Status:** `HYPOTHESIS`

### 3.2 Ringing

**Artifact:** Oscillating halos near sharp edges.

**Possible mechanisms:**
- loss of high-frequency DCT information;
- quantization of high-frequency coefficients;
- selective removal or modification of high-frequency AC coefficients.

**Research questions:**
- Which frequency ranges produce the most visible ringing?
- Can ringing be isolated around edges?
- How does the effect depend on the source image?

**Status:** `HYPOTHESIS`

### 3.3 Mosquito noise

**Artifact:** Small oscillating patterns or noisy halos around sharp edges.

**Possible mechanisms:**
- quantization of high-frequency coefficients;
- interactions between block boundaries and edge detail;
- repeated compression.

**Status:** `HYPOTHESIS`

### 3.4 Contouring and banding

**Artifact:** Smooth gradients become visible as discrete tonal bands.

**Possible mechanisms:**
- aggressive quantization;
- removal or reduction of selected AC frequencies;
- repeated re-encoding.

**Status:** `HYPOTHESIS`

### 3.5 Chroma bleeding

**Artifact:** Color spreads beyond object boundaries or becomes less spatially precise.

**Possible mechanisms:**
- chroma subsampling;
- component-specific block manipulation;
- chroma coefficient changes;
- repeated encoding with chroma subsampling.

**Status:** `HYPOTHESIS`

## 4. Tonal and color effects

### 4.1 Posterization

**Artifact:** The image contains fewer distinct tonal levels, with abrupt transitions between them.

**Possible mechanisms:**
- aggressive quantization;
- removal of selected AC frequencies;
- repeated encode/decode generations;
- combinations of luminance and chroma manipulation.

**Research questions:**
- Can posterization be produced through coefficient-domain operations alone?
- Which frequency bands affect tonal smoothness?
- Can the effect be controlled separately for Y, Cb, and Cr?

**Status:** `HYPOTHESIS`

### 4.2 False colors

**Artifact:** Unexpected color regions or strong color distortions.

**Possible mechanisms:**
- separate manipulation of Cb and Cr;
- component-specific block transformations;
- changes to chroma quantization;
- entropy-stream corruption.

**Status:** `HYPOTHESIS`

### 4.3 Solarization-like effects

**Artifact:** Unusual tonal inversions, bright contours, or color changes resembling solarization.

**Possible mechanisms to investigate:**
- selective coefficient sign changes;
- aggressive changes to quantization;
- component-specific transformations;
- combinations of tonal and chroma operations.

**Technical note:** DQT values do not directly cause an 8-bit IDCT wraparound. Dequantization multiplies quantized coefficients by quantization values; conforming IDCT implementations produce clipped sample values. A solarization-like result must be demonstrated rather than attributed to a fictional integer overflow mechanism.

**Status:** `HYPOTHESIS`

## 5. Spatial and structural effects

### 5.1 Block displacement

**Artifact:** Parts of the image appear shifted, displaced, or rearranged in block-sized units.

**Possible mechanisms:**
- moving quantized DCT blocks;
- remapping block positions;
- block duplication or swapping;
- MCU-level transformations.

**Research questions:**
- How do component sampling factors affect block alignment?
- What happens at image boundaries?
- Can displacement be applied with a brush or mask?

**Status:** `HYPOTHESIS`

### 5.2 Block repetition

**Artifact:** Repeated image fragments or patterns.

**Possible mechanisms:**
- duplicate coefficient blocks;
- repeat selected blocks or MCUs;
- copy compatible blocks from another image.

**Status:** `HYPOTHESIS`

### 5.3 Ghosting / echoes

**Artifact:** Repeated or displaced image structures that may resemble visual echoes.

**Possible mechanisms to investigate:**
- duplication of compatible entropy-coded scan ranges;
- block or MCU duplication;
- coefficient-domain duplication;
- combinations of spatial transformations.

**Technical constraints:**

Entropy-coded data is a continuous variable-length bitstream, not a sequence of independently copyable blocks. A stream-range copy may depend on:

- Huffman code boundaries;
- bit alignment;
- DC predictors;
- component scan order;
- byte stuffing;
- restart intervals.

A copied range may fail to decode or produce a result different from the intended visual echo. A translucent duplicate silhouette is not guaranteed by copying bytes.

**Status:** `HYPOTHESIS`

### 5.4 Smear / tearing

**Artifact:** Horizontal or vertical streaks, displaced regions, or broad areas of corrupted image data.

**Possible mechanisms:**
- changes to DC differences;
- entropy-coded scan corruption;
- block displacement;
- scan synchronization loss.

**Technical note:** JPEG DC values are differentially coded. Changing one DC difference can shift the reconstructed DC values of subsequent blocks of the same component until a restart reset. The propagation is not necessarily infinite: restart markers reset DC predictors.

**Status:** `HYPOTHESIS`

### 5.5 Chroma shift

**Artifact:** Color contours no longer align with luminance contours.

**Possible mechanisms:**
- component-specific block displacement;
- chroma block remapping;
- valid re-encoding with altered sampling;
- carefully controlled component transformations.

**Technical note:** SOF component identifiers and sampling factors, as well as SOS component mappings, define how components are interpreted. Arbitrarily changing component identifiers or ordering is more likely to cause a decoding error or invalid interpretation than a clean chroma displacement.

**Status:** `HYPOTHESIS`

## 6. Component and frequency experiments

JPEG images commonly contain three components:

- **Y** — luminance: brightness and much of the visible image structure.
- **Cb** — blue-difference chroma component.
- **Cr** — red-difference chroma component.

The exact interpretation of component identifiers and table assignments must be read from the JPEG frame and scan metadata. Do not assume that every file uses the same component IDs or quantization-table assignments.

### 6.1 Component isolation

**Artifact:** Grayscale, color separation, or component-specific distortions.

**Operations to investigate:**
- zero selected coefficients in Y;
- zero selected coefficients in Cb;
- zero selected coefficients in Cr;
- modify one component while preserving the others;
- compare component-specific DC and AC operations.

**Status:** `HYPOTHESIS`

### 6.2 Frequency-band removal

**Artifact:** Changes in detail, contours, texture, and tonal structure.

**Mechanism:** Selectively zero or modify quantized DCT coefficients in frequency bands.

Frequency selection should distinguish:

- DC — the average level of an 8×8 block;
- low AC frequencies — broad changes and large-scale variation within a block;
- mid AC frequencies — medium-scale structure;
- high AC frequencies — fine detail and sharp transitions.

**Status:** `HYPOTHESIS`

### 6.3 Horizontal and vertical frequency selection

DCT coefficients have two frequency coordinates:

- **u** — horizontal frequency;
- **v** — vertical frequency.

The interface should initially expose these as two simple selectors, with both directions selected by default. More advanced independent control can be added later.

A visual frequency icon should show the corresponding 8×8 basis pattern, so users can understand the spatial structure represented by a frequency.

**Status:** `HYPOTHESIS`

## 7. Engraving — component AC/DC removal

**Working name:** Engraving  
**Proposed artifact:** A monochrome, etched, or engraving-like image.

**Proposed operation:** Zero AC and DC coefficients in components 1 and 2 of a three-component JPEG.

**Important ambiguity to resolve:** In a conventional three-component JPEG, components 1 and 2 may correspond to Cb and Cr, but component identifiers and ordering must be read from the actual file. Do not hardcode this assumption.

If all DC and AC coefficients of both chroma components are set to zero, the chroma information is removed. The likely result is a grayscale image, not necessarily an engraving.

Therefore this proposal must be treated as a hypothesis, not as a verified engraving algorithm.

**Experiments:**

1. Zero all AC coefficients in Cb and Cr while preserving DC.
2. Zero DC and AC coefficients in Cb and Cr.
3. Compare the two results on portraits, architecture, and textured images.
4. Test whether additional selective Y-frequency removal or modification produces an etched appearance.
5. Compare against existing component-isolation and frequency-removal operations to determine whether this is a distinct preset or merely a combination of existing capabilities.

**Duplicate check:** The underlying operations overlap with component selection and AC/DC coefficient manipulation. The potentially new part is the visual recipe and its resulting appearance, not necessarily a new JPEG operation.

**Status:** `HYPOTHESIS`

## 8. Entropy and bitstream effects

### 8.1 Scan corruption

**Artifact:** Corrupted regions, streaks, block shifts, decoder recovery artifacts, or complete decoding failure.

**Possible mechanisms:**
- bit flips in entropy-coded scan data;
- byte replacement;
- byte insertion or deletion;
- burst corruption;
- controlled changes to Huffman-coded symbols.

**Technical constraints:**
- variable-length Huffman coding;
- byte stuffing (`FF 00`);
- DC predictors;
- restart markers;
- decoder-specific error recovery.

**Status:** `HYPOTHESIS`

### 8.2 Entropy range duplication

**Artifact:** Repeated or unexpected structures, potentially with spatial displacement.

**Mechanism:** Duplicate a range of entropy-coded data within a scan.

**Research questions:**
- Can valid symbol boundaries be identified reliably?
- How do DC predictors affect the copied region?
- Can restart intervals provide useful boundaries?
- What happens when the copied range is not byte-aligned?

**Status:** `HYPOTHESIS`

### 8.3 Bitstream desynchronization

**Artifact:** Large-scale corruption after a local modification.

**Mechanism:** Modify a variable-length coded region so that subsequent bits are decoded under a different symbol alignment.

**Research questions:**
- How does the browser decoder recover?
- Which mutations produce localized artifacts?
- Which mutations make the file undecodable?

**Status:** `HYPOTHESIS`

## 9. Marker and raw-byte effects

### 9.1 DQT manipulation

**Artifact:** Changes in sharpness, detail, blocking, and tonal structure.

**Mechanism:** Change quantization-table values and re-encode through the supported pipeline.

**Important:** DQT table IDs do not universally mean brightness and color. The frame's component quantization-table selectors determine which table is used by each component. In common three-component JPEGs, table 0 is often used for Y and table 1 for Cb/Cr, but the application must inspect the actual JPEG.

**Status:** Existing DQT editing capability; further visual characterization required.

### 9.2 Marker corruption

**Artifact:** Invalid files, decoding failures, or unexpected decoder behavior.

**Mechanism:** Modify marker codes, lengths, or segment contents.

**Status:** `HYPOTHESIS`

### 9.3 Raw-byte manipulation

**Operations:**
- flip bits;
- replace bytes;
- insert bytes;
- delete bytes;
- duplicate ranges;
- swap ranges;
- reverse ranges;
- repeat ranges;
- shuffle selected bytes.

**Important:** These operations are not equivalent to block or MCU transformations. They modify the file representation directly and may invalidate the JPEG.

**Status:** `HYPOTHESIS`

## 10. Existing operations and overlap

Before implementing a new tool, compare it with existing functionality.

Existing implemented families include:

- coefficient editing;
- DQT matrix editing;
- block transformations;
- scan corruption;
- masks and region selection;
- deterministic random operations;
- operation history and replay.

The catalog should not duplicate these as new features merely because they can produce a different visual result.

For every proposed new effect, ask:

1. Can existing operations already produce it?
2. Is the missing part a new algorithm or only a better preset?
3. Does the effect require a new JPEG representation or parser capability?
4. Can the result be reproduced reliably?
5. Does the operation produce useful results on more than one input image?

## 11. Experiment report template

For every actual experiment, record:

- **Name**
- **Date**
- **Input JPEG**
- **JPEG properties** — dimensions, components, sampling, tables, coding mode
- **Hypothesis**
- **Operation**
- **Parameters**
- **Seed**, if applicable
- **Output**
- **Visual observations**
- **Decoder behavior**
- **Reproducibility**
- **Limitations**
- **Conclusion**
- **Status**

Actual test results belong in `GLITCH_EXPERIMENTS.md`, not only in this catalog.

## 12. Evaluation criteria

Evaluate an effect along these dimensions:

- visual distinctiveness;
- controllability;
- reproducibility;
- usefulness across different images;
- ability to localize the effect;
- technical clarity;
- decoder compatibility;
- implementation complexity;
- whether it adds a genuinely new capability.

A technically interesting mutation is not automatically a useful creative tool. A visually compelling result is not automatically evidence that the proposed mechanism is correct.
