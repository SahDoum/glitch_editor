# Milestone 0 — Interface Inventory and Terminology

**Status:** Complete inventory of existing tools, controls, and terminology.  
**Date:** November 8, 2024  
**Phase:** Phase 2 — Interface Refinement & Glitch Research

**Snapshot note:** This is the Milestone 0 baseline, not a description of the
post-Milestone-1 controls. For the current interface, use
[INTERFACE.md](./INTERFACE.md) and
[INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md).

**Quick reference:** For faster lookup during development, see [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md). This document contains the full detailed analysis.

---

## 1. Current Application Overview

The JPEG Glitch Editor is a browser-based local-first tool for non-destructive editing of JPEG data structures. The interface is organized into:

- **Top bar:** File operations, undo/redo, save/export
- **Left toolbar:** 8 canvas tools in 6 grouped categories
- **Center canvas:** Decoded preview with grid overlays and manipulation
- **Right panel:** Active tool settings, operation history, JPEG structure info

---

## 2. Canvas Tools Inventory

### 2.1 Tool Groups and Shortcuts

All tools are activated by clicking the toolbar button or pressing their keyboard shortcut:

#### Manipulation (2 tools)
| Tool | Shortcut | Purpose | Control Type |
|------|----------|---------|--------------|
| **Hand (V)** | V | Pan/move the canvas view | None (gesture-based) |
| **Inspector (I)** | I | Inspect JPEG structure; select blocks to view coefficients | Block selection + arrow keys |

#### Masks (2 tools)
| Tool | Shortcut | Purpose | Control Type |
|------|----------|---------|--------------|
| **Brush (B)** | B | Draw free-form mask regions with a brush | Brush settings panel |
| **Select (M)** | M | Create rectangular mask selections | Rectangle drag + keyboard nav |

#### JPEG Effects (1 tool)
| Tool | Shortcut | Purpose | Control Type |
|------|----------|---------|--------------|
| **Coefficient Glitch (G)** | G | Edit DCT coefficients and apply experimental recipes | Brush/select + effect settings |

#### Blocks (1 tool)
| Tool | Shortcut | Purpose | Control Type |
|------|----------|---------|--------------|
| **Block Transform (T)** | T | Copy, swap, repeat, or permute 8×8 DCT blocks | Mode dropdown + gesture |

#### Quantization (1 tool)
| Tool | Shortcut | Purpose | Control Type |
|------|----------|---------|--------------|
| **Quantization Matrix (Q)** | Q | Edit DQT (quantization) tables directly | Table cells + pattern dropdown |

#### Entropy Experiments (1 tool)
| Tool | Shortcut | Purpose | Control Type |
|------|----------|---------|--------------|
| **Scan Corrupt (C)** | C | Manipulate entropy-coded scan bytes | Scan selection + offset controls |

---

## 3. Mask System

### 3.1 Mask Concepts

- **Coordinate system:** Always pixel coordinates in the decoded image space, NOT DCT block or MCU coordinates.
- **Mask type:** Raster bitmap specifying which pixels are affected.
- **Coverage display:** Visual overlay showing affected 8×8 blocks.
- **Snap options:** Block snap (component default) or MCU snap (optional).

### 3.2 Brush Tool

**Current parameters:**

| Parameter | Type | Current UI | Notes |
|-----------|------|-----------|-------|
| Brush size | Numeric | Slider (pixels) | Determines brush footprint |
| Brush opacity | Numeric | Slider (0–100) | Soft edges; default 100% |
| Brush hardness | Numeric | Slider (0–100) | Edge softness; default 50% |

**Current issues:**
- New brush stroke replaces previous mask; no additive/subtractive modes.
- No eraser or undo for individual strokes.
- Brush is not keyboard-accessible.
- Parameters are not persistent across sessions.

**Saved brushes (localStorage):**
- Built-in brushes: Small, Medium, Large, Dotted
- Custom brushes: User-created, locally stored, can be renamed
- Auto-apply toggle: Per-brush setting to auto-apply selected operation

### 3.3 Select Tool

**Current parameters:**

| Parameter | Type | Current UI | Notes |
|-----------|------|-----------|-------|
| Snap to | Dropdown | 2 options | "Component blocks" (default) or "MCUs" |

**Current keyboard interaction:**
- Arrow keys: Move cursor by one block
- Enter: Start/finish rectangular selection
- Escape: Clear selection
- Ctrl/⌘+A: Select all visible area

**Current issues:**
- Selection must be rectangular.
- No free-form or lasso selection.
- No saved named selections (other than activating a saved mask).

---

## 4. Coefficient Glitch Tool

**Domain:** Quantized DCT coefficients (JPEG-coefficients)  
**Requires re-encoding:** Yes

### 4.1 Parameters

| Parameter | Type | Current UI | Values/Range |
|-----------|------|-----------|--------------|
| **Frequency band** | Dropdown | 4 options | "Low", "Mid", "High", "All" |
| **Mode** | Dropdown | 7 options | "Add", "Multiply", "Set", "Shuffle", "Invert", "Substitute", "Shuffle blocks" |
| **Component** | Dropdown | Dynamic | "Y", "Cb", "Cr", or missing |
| **Strength** | Numeric | Slider | 0–255 (depends on band) |
| **Seed** | Numeric | Number input | Random seed for deterministic shuffles |

### 4.2 Frequency Bands

- **Low:** DC + zero AC coefficients
- **Mid:** Middle-frequency AC coefficients
- **High:** High-frequency AC coefficients
- **All:** Every coefficient

### 4.3 Glitch Modes

| Mode | Behavior | Requires mask | Deterministic |
|------|----------|---------------|--------------|
| **Add** | Add strength value to coefficients | Yes | Yes |
| **Multiply** | Scale coefficients by strength ratio | Yes | Yes |
| **Set** | Replace coefficients with constant | Yes | Yes |
| **Shuffle** | Randomly swap coefficient values | Yes | With seed |
| **Invert** | Negate coefficients | Yes | Yes |
| **Substitute** | Replace with random values in range | Yes | With seed |
| **Shuffle blocks** | Permute coefficient values across blocks | Optional | With seed |

### 4.4 Experimental Recipes

Pre-built multi-step recipes apply a sequence of coefficient operations:

| Recipe Name | Steps | Purpose | Status |
|-------------|-------|---------|--------|
| "Candy" | 4 steps | High-frequency boost + saturation | Built-in |
| "Datamosh" | 3 steps | DC corruption + block shuffle | Built-in |
| "Posterize" | 2 steps | AC truncation + re-quantization | Built-in |
| Others | N/A | User-defined recipes saved to localStorage | User-created |

**Recipe workflow:**
1. Activate Coefficient Glitch tool
2. Select a recipe from dropdown
3. Draw/select mask area
4. Click "Apply recipe"
5. Creates ONE history entry for entire recipe

---

## 5. Block Transform Tool

**Domain:** 8×8 DCT block structure (JPEG-structure)  
**Requires re-encoding:** Yes

### 5.1 Modes and Parameters

| Mode | Parameters | UI | Description |
|------|-----------|-----|-------------|
| **Shuffle** | seed | Slider + randomize button | Permute block order within mask |
| **Transfer** | source region, action | Drag gesture | Copy/swap blocks from source to destination |
| **Repeat** | source block, target count | Drag gesture + spinner | Repeat one block N times |

### 5.2 Transfer Workflow

- Activation: Enable "Transfer" mode in Block Transform settings
- Step 1: Click/drag to select source block or region (shows blue overlay)
- Step 2: Click/drag to select destination (shows red overlay)
- Action dropdown: "Copy" (source → dest) or "Swap" (bidirectional)
- Applies immediately or adds to history

### 5.3 Repeat Workflow

- Activation: Enable "Repeat" mode
- Step 1: Click a single block as source
- Step 2: Drag to destination, or set target count
- Fills rectangular region with copies of source block

**Limitations:**
- Transfer is limited to 262,144 blocks max (MAX_BLOCK_TRANSFER_BLOCKS)
- Coordinates are in MCU or component block space, not pixel space
- No undo for in-progress gestures until applied

---

## 6. Quantization Matrix Tool

**Domain:** DQT marker (JPEG-structure)  
**Requires re-encoding:** Yes

### 6.1 Parameters

| Parameter | Type | Current UI | Notes |
|-----------|------|-----------|-------|
| **Table ID** | Dropdown | 4 options | 0, 1, 2, 3 (rarely more than 2 used) |
| **Direct edit** | Table input | 64 cells per table | Manual cell-by-cell editing |
| **Pattern** | Dropdown | "Custom" + 3 built-in | Apply uniform pattern to table |
| **Semantics** | Dropdown | 2 options | "Reinterpret" or "Requantize" |
| **Seed** | Numeric | Number input | For randomized pattern generation |

### 6.2 Quantization Patterns

| Pattern | Behavior | Parameter |
|---------|----------|-----------|
| **Uniform** | All cells = constant | Single value |
| **Linear** | Cells scale with frequency | Frequency factor |
| **Random** | Cells drawn from range | Min/max + seed |

### 6.3 Semantics: "Reinterpret" vs "Requantize"

- **Reinterpret:** Change the table, re-encode with original coefficients (visual change, no DC/AC loss interpretation needed)
- **Requantize:** Actually change how coefficients are quantized/dequantized (more complex, requires re-reading scan data)

**Current implementation:** Only "Reinterpret" is fully supported.

### 6.4 Current Issues

- Cell edits are not per-component; all components share table ID assignments
- No visual preview of how changed quantization affects the image
- Distinction between semantics is unclear in UI
- Manual editing has no constraint checker (e.g., warns if cell > 255)

---

## 7. Scan Corrupt Tool

**Domain:** Entropy-coded scan bytes (entropy-stream)  
**Requires re-encoding:** No (attempts direct byte manipulation)

### 7.1 Parameters

| Parameter | Type | Current UI | Notes |
|-----------|------|-----------|-------|
| **Scan index** | Dropdown | Dynamic | Lists all scans in file |
| **Byte offset** | Numeric | Slider or input | Position within scan data |
| **Byte value** | Numeric | Input (0–255) | Raw byte to write |
| **Operation** | Dropdown | 3+ options | "Set", "XOR", "Add", etc. |

### 7.2 Workflow

1. Open file
2. Select Scan Corrupt tool
3. Choose scan index
4. Set offset and operation
5. Click "Apply corruption"
6. Result may be undecodable; shows error if so

**Warnings:**
- Direct byte manipulation can produce undecodable files
- Changes are destructive; no undo of scans
- Requires knowledge of entropy stream format
- Byte stuffing and bit alignment are not handled automatically

**Current issues:**
- No visual feedback of what bytes are being changed
- No validation that result will remain decodable
- Corruption is applied directly, not through re-encoding

---

## 8. Inspector Tool

**Domain:** Read-only inspection (no edits)

### 8.1 Displays

| Section | Shows | Update trigger |
|---------|-------|-----------------|
| **Basic metadata** | Width, height, color space, sampling factors | File open |
| **Components** | Y/Cb/Cr: ID, sampling, quantization table | File open |
| **Quantization tables** | All DQT tables in 8×8 grid | File open |
| **Scan info** | Entropy scan ranges, data offsets, component order | File open |
| **Selected block coefficients** | 8×8 quantized coefficients (natural order) | Block selected with arrow keys + Enter |

### 8.2 Keyboard Navigation

- Arrow keys: Move cursor through 8×8 blocks
- Enter: Select block, show its coefficients
- Escape: Deselect
- Live region announcements: Block position, coordinates, selected status

---

## 9. History and Undo/Redo

### 9.1 Operation History Display

- **Order:** Newest operations shown at top
- **Evaluation:** Computed bottom-to-top from original
- **Changes:** Reordering, enabling/disabling, deletion all trigger re-evaluation

### 9.2 History Controls

| Control | Effect | Notes |
|---------|--------|-------|
| **Toggle (eye icon)** | Enable/disable operation | Re-evaluates all subsequent |
| **Move up/down** | Change application order | Re-evaluates from that point |
| **Delete (X)** | Remove operation | Cannot undo via undo button |
| **Restore snapshot** | Revert to saved mask state | Only if operation has saved mask |
| **Reset** | Clear all operations | Requires confirmation |

### 9.3 Undo/Redo

- Ctrl/⌘+Z: Undo last change (add/remove/modify operation)
- Ctrl/⌘+Shift+Z or Ctrl/⌘+Y: Redo
- **Limitation:** Undo does not preserve brush draft (partial mask being drawn)

---

## 10. Save and Export

### 10.1 File Formats

| Format | Extension | Contains | Overwrites original |
|--------|-----------|----------|---------------------|
| **JPEG export** | .jpg | Current decoded pixels re-encoded as JPEG | No |
| **Project file** | .jpglitch | Original bytes + operation stack + mask snapshots | No (new file) |

### 10.2 Project File Contents (.jpglitch v1)

```json
{
  "version": 1,
  "originalJpegBase64": "...",  // Exact original JPEG bytes
  "originalChecksum": "...",     // SHA-256 or similar
  "operations": [...],           // Full operation stack with parameters
  "savedMasks": [...],           // Named masks with snapshots
  "metadata": {
    "appVersion": "...",
    "timestamp": "..."
  }
}
```

### 10.3 Save Shortcuts

- Ctrl/⌘+S: Opens save dialog (choose export JPEG or save .jpglitch)
- Ctrl/⌘+O: Opens file picker (load JPEG or .jpglitch)

---

## 11. Terminology Issues and Clarifications Needed

### 11.1 Unclear Terms

| Term | Current usage | Ambiguity | Recommendation |
|------|---------------|-----------|-----------------|
| **Glitch** | Generic: any JPEG artifact effect | Implies unintended damage | Consider "Effect" or "Corruption" depending on context |
| **Brush** | Mask tool; also "experimental brush" for recipes | Two different meanings | Distinguish as "Mask brush" vs "Effect recipe" |
| **Recipe** | Multi-step coefficient operation | May be confused with saved presets | Keep distinct; recipes are process sequences |
| **Mask** | Raster region selector | "Mask" = operation mask? blend mask? | Clarify: "operation mask" (defines affected area) |
| **Component** | Y/Cb/Cr channel (JPEG term) | May be confused with "operation component" | Use "color component" or "JPEG component" |
| **Block** | 8×8 DCT block | May be confused with MCU or macro block | Use "8×8 block" or "DCT block" consistently |
| **Coefficient** | Quantized DCT value in natural order | Raw vs dequantized vs different orderings | Specify "quantized coefficient" when needed |
| **Scan** | Entropy-coded segment of JPEG | Multiple meanings (progressive scans vs baseline scans) | Use "entropy scan" for clarity |
| **Sampling factor** | Component sub-sampling ratio (e.g., 4:2:0) | Unclear if refers to subsampling or the table | Use "chroma subsampling factor" |

### 11.2 Terminology Decisions

**Adopt these standard terms going forward:**

1. **JPEG Domain:** When referring to DCT/quantization/entropy operations (not pixel-space)
2. **Color Component:** For Y/Cb/Cr channels (instead of bare "component")
3. **8×8 Block** or **DCT Block:** For coefficient blocks
4. **Operation Mask:** The raster region defining where an effect applies
5. **Effect** or **Corruption:** Depending on intention; avoid bare "glitch"
6. **Brush Tool:** The interface element for drawing masks
7. **Experimental Recipe:** A saved multi-step operation sequence
8. **Quantized Coefficient:** Explicit term for values stored in JPEG
9. **Entropy Scan:** The compressed data segment in JPEG
10. **Chroma Subsampling:** The Y/Cb/Cr sampling ratio

---

## 12. Control Types Inventory

### 12.1 Current UI Component Types

| Component Type | Current Usage | Issues |
|---|---|---|
| **Dropdown/Select** | Frequency band, mode, component, table ID, snap option, semantic | Too many dropdowns; hard to scan |
| **Numeric Slider** | Brush size/opacity/hardness, strength, seed | Range limits unclear; no visual units |
| **Number Input (text)** | Seed, byte value, offsets | No validation; easy to enter out-of-range values |
| **Checkbox** | Operation enabled/disabled (history), auto-apply (brushes) | Minimal use; mostly in history |
| **Button** | Apply, Reset, Save, Export, Randomize | Inconsistent label styles |
| **Text input** | Brush name, recipe name, saved mask name | No character limit feedback |
| **Table** | Quantization cells, coefficient display | Small cells; hard to edit on mobile |

### 12.2 Recommendations for Simplification

**High priority (Milestone 1):**
1. Replace frequency band dropdown with radio buttons (4 options)
2. Replace glitch mode dropdown with segmented control (7 options may need multiple rows or tabs)
3. Replace snap option dropdown with radio buttons (2 options)
4. Add visual slider labels (e.g., "Soft ← Opacity → Hard")
5. Add "Randomize" button next to seed inputs
6. Separate "Core parameters" from "Advanced" sections

**Medium priority:**
1. Replace component dropdown with labeled buttons/icons (Y/Cb/Cr)
2. Add preset buttons for common strength values
3. Show range indicators on sliders

---

## 13. Known Interface Limitations

### 13.1 Mask System Gaps

- No eraser; can only replace entire mask
- No additive/subtractive brush modes
- No saved named selections (only active selection or saved masks)
- Keyboard brush strokes not supported
- No feathering preview

### 13.2 Canvas Interaction Issues

- Narrow screens: Right panel stacks below canvas, reducing work area
- Zoom level: No indicator of current zoom; only increment/decrement
- Pan (Hand tool): Only gesture-based; no keyboard pan
- Brush/Select: No visual feedback until stroke/selection is complete

### 13.3 Tool Interaction

- Brush and Select are mutually exclusive (one active at a time)
- Cannot apply same effect to multiple masks in sequence without saving recipe
- Block Transform Transfer/Repeat modes require precise gesture control
- Scan Corrupt tool has no visual representation of affected bytes

### 13.4 Preview and Comparison

- Original always shown separately (not side-by-side or split comparison)
- No before/after slider or wipe tool
- Toggling original/result requires clicking button
- Re-encoding state not always clear

### 13.5 Accessibility Issues

- Heavy reliance on visual gestures for block operations
- Large tables not well-suited to keyboard/screen-reader navigation
- Color-coded overlays not labeled with text
- Narrow dropdown options may be hard to distinguish by icon alone

---

## 14. Component-Specific Operation Support Matrix

| Tool | Requires color component selection | Supports masks | Requires re-encoding |
|------|-------|---------|-----|
| Coefficient Glitch | Yes | Yes | Yes |
| Block Transform | No (operates on MCUs) | Optional (for region) | Yes |
| Quantization Matrix | Per-table (not per-component) | No | Yes |
| Scan Corrupt | No (entire scan) | No | No |
| Inspector | N/A | N/A | N/A |

---

## 15. Operation Status Tracking

### 15.1 Operation States

| State | Meaning | UI Indicator |
|-------|---------|---------|
| **Queued** | Waiting for worker to process | Spinner icon |
| **Previewing** | Currently being computed | Animated spinner |
| **Applied** | Successfully added to history | Normal history entry |
| **Failed** | Operation rejected or worker error | Red icon + error message |

### 15.2 Diagnostic Information

- Operation errors shown in red below history entry
- Worker timeouts: No current timeout handling; may hang
- Codec errors: Passed through from libjpeg-turbo; may be cryptic

---

## 16. Unsupported JPEG Processes

The editor currently assumes **baseline sequential Huffman-encoded JPEG**. Not tested or supported:

- Progressive JPEG (multiple scans; coefficient bands)
- Arithmetic coding
- Lossless JPEG
- Component precision > 8 bits
- Restart markers (may fail or ignore)
- Custom Huffman tables (assumed default)
- Gray-scale (single component) — unclear if supported
- Component count > 3
- Unusual sampling factors (e.g., 4:4:0)

---

## 17. Next Steps for Milestone 1

Based on this inventory, the following interface redesigns are recommended for **Milestone 1 — Tool Control Redesign**:

### High Priority
1. **Frequency band selector:** Replace dropdown with 4 radio buttons or segmented control
2. **Glitch mode selector:** Replace dropdown with segmented control (may require wrapping)
3. **Snap option:** Replace dropdown with 2 radio buttons
4. **Component selector:** Replace dropdown with labeled buttons or icons (Y/Cb/Cr)

### Medium Priority
5. **Slider labels:** Add text labels showing meaning (e.g., "Opacity", "Hardness")
6. **Randomize buttons:** Add next to all seed inputs
7. **Preset strength values:** Quick buttons for common values (0, 64, 128, 192, 255)

### Visual/UX Improvements
8. **Before/after comparison:** Add split-view or wipe tool
9. **Zoom indicator:** Show current zoom level
10. **Keyboard pan:** Support arrow keys in Hand tool
11. **Block transfer feedback:** Visual preview of source/dest before applying

---

## 18. Unclear Interface Elements Summary

| Element | Current behavior | Question | Resolution |
|---------|------------------|----------|-----------|
| **Brush auto-apply** | Per-brush toggle in localStorage | Should this be a global setting? | Clarify and document |
| **Recipe vs preset** | Recipes are multi-step; presets unknown | Are presets implemented? | Check if feature exists |
| **Mask snapshots** | Operations can restore saved masks | When is snapshot created automatically? | Document save logic |
| **Component dropdown** | Defaults to first available | What if component is unavailable? | Shows error; does not substitute |
| **Seed randomization** | Button to generate new seed | Does this create new random value? | Yes; updates input field |
| **Strength slider range** | Depends on frequency band | Why does range change? | Different bands have different valid ranges |

---

## 19. Appendix: Tools and Shortcuts Quick Reference

### Shortcuts List
```
V → Hand (pan)
I → Inspector (inspect blocks)
B → Brush (draw mask)
M → Select (rectangular selection)
G → Coefficient Glitch (DCT effects)
T → Block Transform (move/swap blocks)
Q → Quantization Matrix (edit DQT)
C → Scan Corrupt (entropy experiments)

Ctrl/⌘+Z → Undo
Ctrl/⌘+Shift+Z / Ctrl/⌘+Y → Redo
Ctrl/⌘+S → Save/Export
Ctrl/⌘+O → Open file
Ctrl/⌘+A → Select all (in Select tool)
```

### Tool Activation Logic
- Activating Coefficient Glitch/Block Transform automatically switches mask tool to Brush (unless Select is active)
- Switching mask tool (Brush↔Select) preserves active effect tool (G, T, Q, C)
- Inspector tool standalone; does not affect effect tools

---

**End of Milestone 0 Inventory**

**Document version:** 1.0  
**Last updated:** November 8, 2024  
**Next phase:** Milestone 1 — Tool Control Redesign (reference this inventory)
