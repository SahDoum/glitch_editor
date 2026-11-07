# Interface Inventory — Quick Reference

**Purpose:** Quick lookup for tools, parameters, and UI elements during development.  
**Full documentation:** See [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md) for complete details.  
**Last updated:** November 8, 2024

---

## Canvas Tools at a Glance

| Group | Tool | Shortcut | Purpose | Mask | Parameters | Issues |
|-------|------|----------|---------|------|-----------|--------|
| **Manipulation** | Hand | V | Pan canvas | – | Gesture-based | ✓ Good |
| | Inspector | I | Inspect blocks | – | Arrow keys + Enter | ✓ Good |
| **Masks** | Brush | B | Draw region | Yes | Size, Opacity, Hardness | No additive mode |
| | Select | M | Rectangle region | Yes | Snap option (dropdown) | Only rectangular |
| **JPEG Effects** | Coefficient Glitch | G | Edit DCT coefficients | Yes | Band, Mode, Component, Strength, Seed | 7 dropdowns |
| **Blocks** | Block Transform | T | Copy/swap/repeat blocks | Optional | Mode dropdown + gesture | Gesture precision |
| **Quantization** | Quantization Matrix | Q | Edit DQT tables | – | Table cells + pattern | No validation |
| **Entropy** | Scan Corrupt | C | Raw byte manipulation | – | Offset + operation | No visual feedback |

---

## Coefficient Glitch Parameters

### Frequency Bands (4 options)
| Band | Contains | Typical Effect |
|------|----------|----------------|
| Low | DC + zero AC | Block boundaries |
| Mid | Middle-range AC | Subtle texture |
| High | High-frequency AC | Ringing, detail loss |
| All | Every coefficient | Strongest effect |

→ **Milestone 1 task:** Replace dropdown with 4 radio buttons

### Glitch Modes (7 options)
| Mode | Effect | Deterministic |
|------|--------|--------------|
| Add | Add value to coefficients | ✓ Yes |
| Multiply | Scale coefficients | ✓ Yes |
| Set | Replace with constant | ✓ Yes |
| Shuffle | Random swap (needs seed) | With seed |
| Invert | Negate coefficients | ✓ Yes |
| Substitute | Random values (needs seed) | With seed |
| Shuffle blocks | Permute across blocks | With seed |

→ **Milestone 1 task:** Replace dropdown with segmented/tabbed control

### Component Selection
| Component | Y/Cb/Cr | Notes |
|-----------|---------|-------|
| Y | Luma (brightness) | Always present |
| Cb | Chroma (blue-yellow) | May be subsampled |
| Cr | Chroma (red-cyan) | May be subsampled |

→ **Milestone 1 task:** Replace dropdown with Y/Cb/Cr buttons

---

## Block Transform Modes

| Mode | Workflow | Gesture | Limits |
|------|----------|---------|--------|
| **Shuffle** | Random permutation within mask | None (click apply) | Seed-based |
| **Transfer** | Copy/swap source → dest | Drag source, drag dest, choose action | Max 262K blocks |
| **Repeat** | Repeat one block N times | Drag source, set count | Max 262K blocks |

→ Issues: Gesture precision difficult; no preview

---

## UI Control Types & Recommendations

| Control Type | Current Usage | Simplification (M1) |
|--------------|---------------|-------------------|
| **Dropdown** | 9+ instances | → Radio buttons (≤4 options) |
| | | → Segmented control (≤7 options) |
| | | → Buttons with icons |
| **Slider** | Brush size, opacity, hardness, strength | ✓ Add text labels |
| | | Add range indicators |
| **Number input** | Seed, offsets, byte values | ✓ Add validation |
| | | → Add "Randomize" button next to seed |
| **Checkbox** | Operation enabled/disabled | ✓ Keep (rare use) |
| **Button** | Apply, Reset, Save, Export | ✓ Consistent labels |
| **Table** | Quantization cells, coefficients | ✓ Small on mobile |
| **Radio/Segmented** | Snap option, band selection | ✓ Expand usage |

---

## Mask System

- **Coordinates:** Always **pixel space** (decoded image), NOT block or MCU coordinates
- **Coverage display:** Visual overlay showing affected 8×8 blocks
- **Snap options:** 
  - Component blocks (default)
  - MCUs (optional)
- **Current limitations:**
  - New stroke replaces previous mask (no additive/subtractive)
  - No eraser; no keyboard brush support
  - Parameters not persistent across sessions

→ **Deferred:** Additive modes, eraser, multi-stroke combinations

---

## Operation History

| Feature | Behavior | Notes |
|---------|----------|-------|
| **Display order** | Newest first | Visual; computed bottom-to-top |
| **Enable/disable** | Toggle operation on/off | Re-evaluates all subsequent |
| **Reorder** | Move operation up/down | Triggers re-evaluation |
| **Delete** | Remove operation | Permanent (no restore via undo) |
| **Restore mask** | Revert to saved mask snapshot | Only if operation has snapshot |
| **Reset all** | Clear history | Requires confirmation |
| **Undo/Redo** | Ctrl/⌘+Z / Ctrl/⌘+Y | Works on operations only |

---

## Save & Export

| Format | Extension | Contains | Overwrites |
|--------|-----------|----------|-----------|
| **JPEG** | .jpg | Decoded pixels re-encoded | No |
| **Project** | .jpglitch | Original bytes + ops + masks | No (new file) |

**Project file (v1):**
```json
{
  "version": 1,
  "originalJpegBase64": "...",
  "originalChecksum": "...",
  "operations": [...],
  "savedMasks": [...]
}
```

---

## Terminology Standardization

| Term | Old usage | New standard | Context |
|------|-----------|--------------|---------|
| Glitch | Generic effect | "Effect" or "Corruption" | Depends on intent |
| Brush | (dual meaning) | "Mask brush" or "Effect recipe" | Distinguish uses |
| Mask | Ambiguous | "Operation mask" (region selector) | Region affecting operations |
| Component | Confusing | "Color component" (Y/Cb/Cr) | JPEG domain |
| Block | Generic | "8×8 block" or "DCT block" | Coefficient grid |
| Scan | Generic | "Entropy scan" (compressed segment) | Scan data |
| Sampling | Unclear | "Chroma subsampling factor" | Y/Cb/Cr ratio |

---

## Known Interface Limitations

### Mask System
- [ ] No eraser; new stroke replaces entire mask
- [ ] No additive/subtractive brush modes
- [ ] No saved named selections
- [ ] Keyboard brush strokes not supported
- [ ] No feathering preview

### Canvas Interaction
- [ ] Narrow screens: Right panel stacks below canvas
- [ ] No zoom level indicator
- [ ] Pan (Hand tool) only gesture-based
- [ ] No visual feedback until stroke/selection complete

### Tool Interaction
- [ ] Brush and Select mutually exclusive
- [ ] Cannot apply same effect to multiple masks in sequence
- [ ] Block Transfer/Repeat requires precise gesture control
- [ ] Scan Corrupt has no visual byte representation

### Preview & Comparison (→ Milestone 2)
- [ ] No before/after split-view or wipe tool
- [ ] Original/result toggled by button only
- [ ] Re-encoding state not always clear
- [ ] No live parameter preview

### Accessibility
- [ ] Heavy gesture reliance
- [ ] Large tables not keyboard-friendly
- [ ] Color-coded overlays not labeled
- [ ] Dropdown options hard to distinguish

---

## Component Support Matrix

| Tool | Requires Color Component | Supports Masks | Re-encoding |
|------|-------------------------|----------------|------------|
| Coefficient Glitch | Yes | Yes | Yes |
| Block Transform | No (MCU-level) | Optional | Yes |
| Quantization Matrix | Per-table | No | Yes |
| Scan Corrupt | No | No | No |

---

## Unsupported JPEG Processes

Editor assumes **baseline sequential Huffman**. Not tested:

- Progressive JPEG
- Arithmetic coding
- Lossless JPEG
- Component precision > 8 bits
- Restart markers (may fail)
- Custom Huffman tables
- Gray-scale (unclear if supported)
- Component count > 3
- Unusual sampling factors (e.g., 4:4:0)

---

## Shortcut Reference

### Tools
```
V → Hand (pan)
I → Inspector (inspect blocks)
B → Brush (draw mask)
M → Select (rectangular selection)
G → Coefficient Glitch (DCT effects)
T → Block Transform (move/swap blocks)
Q → Quantization Matrix (edit DQT)
C → Scan Corrupt (entropy experiments)
```

### General
```
Ctrl/⌘+Z → Undo
Ctrl/⌘+Shift+Z / Ctrl/⌘+Y → Redo
Ctrl/⌘+S → Save/Export
Ctrl/⌘+O → Open file
Ctrl/⌘+A → Select all (in Select tool)
```

### Inspector (when active)
```
↑ ↓ ← → → Move cursor through blocks
Enter → Select block, show coefficients
Escape → Deselect
```

### Select tool (when active)
```
↑ ↓ ← → → Move cursor by one block
Enter → Start/finish rectangular selection
Escape → Clear selection
Ctrl/⌘+A → Select all
```

---

## Milestone 1 Quick Tasks (Ready to Start)

| Task | Effort | Blocking |
|------|--------|----------|
| Frequency band → 4 radio buttons | Low | No |
| Component selector → Y/Cb/Cr buttons | Low | No |
| Snap option → 2 radio buttons | Low | No |
| Slider labels + range indicators | Low | No |
| Randomize buttons (seed inputs) | Medium | No |
| Glitch mode → segmented/tabbed | High | No |
| Test keyboard & screen sizes | Medium | Blocks acceptance |
| Update INTERFACE.md | Low | Documentation |

---

## Cross-References

- **Full inventory details:** [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md)
- **Roadmap:** [ROADMAP.md](./ROADMAP.md) (sections 3–6 for planned milestones)
- **Roadmap Phase 1 (completed):** [ROADMAP_PHASE_1_ARCHIVE.md](./ROADMAP_PHASE_1_ARCHIVE.md)
- **Current interface description:** [INTERFACE.md](./INTERFACE.md)
- **Glitch research catalog:** [GLITCH_CATALOG.md](./GLITCH_CATALOG.md)
- **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Product scope:** [PRODUCT.md](../PRODUCT.md)

---

## How to Use This Document

**During development:**
- Use this quick reference to look up tool parameters and controls
- Link to full [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md) for detailed analysis
- Check "Known Interface Limitations" section for what's NOT implemented
- Reference "Milestone 1 Quick Tasks" to understand redesign priorities

**When starting a new milestone:**
- Review the relevant section of [ROADMAP.md](./ROADMAP.md)
- Check this quick reference for parameter details
- Consult full inventory for context and acceptance criteria

**For PR reviews:**
- Verify changes match terminology standards
- Check that new controls follow redesign paradigm from Milestone 1
- Ensure accessibility requirements are met

---

**Document version:** 1.0  
**Scope:** Phase 2 — Interface Refinement & Glitch Research  
**Status:** Reference document (living; update as development progresses)
