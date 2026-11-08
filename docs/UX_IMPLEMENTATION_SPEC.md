# UX Implementation Specification — JPEG Glitch Editor

**Status:** Draft  
**Purpose:** Implementation specification for an AI coding agent  
**Scope:** UX and interface redesign of the existing JPEG Glitch Editor  
**Platform:** Browser application

---

## 1. Objective

Redesign the existing JPEG Glitch Editor interface to make JPEG-domain glitch operations accessible to glitch artists without hiding the technical nature of the underlying operations.

The application must retain its existing JPEG processing engine, operation model, history, selection mechanisms and supported capabilities.

This is an interface redesign, not a rewrite of the JPEG engine.

### Primary UX principles

1. **Glitch-art-first:** prioritize creative workflows over exposing JPEG internals by default.
2. **Progressive disclosure:** keep frequently used controls visible; place advanced technical parameters in collapsible sections.
3. **Visual explanation:** explain JPEG concepts through the user's current image and meaningful visualizations.
4. **Non-destructive editing:** preserve the original image and existing operation-history semantics.
5. **Reproducibility:** retain deterministic seeds and operation parameters.
6. **Consistency:** effects should follow a common interaction model while retaining their individual requirements.

## 2. Mandatory preliminary investigation

Before implementation, inspect the existing application and identify:

- Current component hierarchy and layout.
- Existing canvas tools and their state management.
- Effect implementations and their actual application modes.
- Current preview and apply pipelines.
- Existing history and undo/redo mechanisms.
- Selection and brush-mask implementation.
- Component selection (Y / Cb / Cr).
- DCT frequency-band controls.
- Seed handling and persistence.
- Existing Scan Corrupt and Quantization Matrix interfaces.
- Existing project persistence and serialization.

Do not replace working functionality merely to match the proposed layout.

Do not introduce a second selection system, operation history, preview pipeline, or JPEG-processing mechanism.

Reuse existing domain logic wherever possible. Refactor only where necessary to support the specified UX.

If the current implementation differs from this document in an important technical detail, inspect the implementation and report the discrepancy before making assumptions.

## 3. Main workspace layout

Use a desktop-oriented three-column workspace.

### 3.1 Top application bar

Retain the existing application-level actions:

- Open/import JPEG.
- Project actions, where currently supported.
- Undo / Redo.
- Original/result comparison.
- Export.

Do not redesign unrelated application-level functionality unless required for layout compatibility.

### 3.2 Left panel — Effects

The left panel must be a full-width effects catalog, not a compact icon toolbar.

Requirements:

- Display effect names as a compact text list.
- Include short descriptions beneath or beside effect names.
- Group effects into categories.
- Allow ordinary vertical scrolling.
- Keep the catalog visible when an effect is selected.
- Selecting an effect opens its settings in the right panel.
- Do not use image cards or a gallery-style layout.
- Do not implement search or collapsible categories in this iteration.
- Do not implement user-created effects or presets in this iteration.

The catalog must use the actual effects implemented by the application. Do not advertise planned or unsupported operations as available.

### 3.3 Center — Canvas

The canvas remains the primary workspace.

Preserve existing functionality:

- Zoom and pan.
- Original/result comparison.
- Image preview.
- DCT block and MCU overlays, where supported.
- Existing inspection functionality.

Place canvas tools in a horizontal toolbar above the canvas.

Tools include the existing equivalents of:

- Hand.
- Brush.
- Select.
- Inspector.

Context-sensitive tool controls must appear in the same horizontal toolbar row.

For example, when Brush is active, show brush size and snapping controls there.

### 3.4 Right panel — Effect Settings and History

Divide the right panel into two independent vertical zones:

**Upper zone: Effect Settings**
- Displays settings for the currently selected effect.
- Has its own scrolling area.
- Contains effect controls, Preview, Apply and Advanced settings where applicable.

**Lower zone: History**
- Always remains visible.
- Has its own scrolling area.
- Retains existing history functionality.

The two zones must have independently controlled heights and scrolling. Scrolling the settings must not scroll History, and vice versa.

The existing History implementation includes a Restore Selection action. Preserve it; do not introduce a duplicate control.

## 4. Effect selection and settings persistence

Only one effect's settings are displayed at a time.

When the user switches to another effect:

- The previous effect's settings are preserved.
- The newly selected effect's settings are displayed.
- Returning to the previous effect restores its last-used settings.
- The Effects catalog remains visible.

Last-used settings must persist after Apply, effect switching, and reopening the project, subject to the application's existing project-persistence capabilities.

Important distinction:

- **Effect defaults / last-used settings** describe the current working configuration of an effect.
- **History operation parameters** are immutable snapshots of the parameters used by an already-applied operation.

Changing an effect's current settings must not modify an existing History operation.

## 5. Effect application modes

Each effect must explicitly define its application mode.

Do not assume that every effect uses the same selection mechanism.

### 5.1 Full-image effects

Operate on the entire image without requiring a selection.

Examples include:
- Scan Corrupt.
- Quantization Matrix, subject to its actual implementation semantics.

These effects must not require Brush or Select.

### 5.2 Selection-based effects

Operate on the existing spatial selection/mask.

Examples include:
- Pixelate.
- AC Scale.
- Posterization.
- Ringing.
- Engraving.
- Block Shuffle.

Behavior:

- Display effect settings immediately, even when no selection exists.
- If no valid selection exists, disable Preview and Apply.
- Show a concise text explanation that an area must be selected.
- Subtly highlight the available Brush and Select tools.
- Once a valid selection exists, enable the relevant actions.

Suggested message:

"Select an area to apply this effect."

Do not hide effect settings while waiting for a selection.

#### Apply while painting (Auto Apply)

Selection-based effects must support an optional **Apply while painting** checkbox.

When enabled:
- Applying the effect is triggered automatically as the user paints with the Brush tool.
- Each completed brush stroke applies the current effect using the current settings and the resulting mask.
- The user does not need to press Apply after each stroke.
- Each completed stroke must create a separate undoable History operation.
- The effect settings remain available and unchanged between strokes.

When disabled:
- Brush and Select only create or modify the selection.
- The user explicitly triggers Preview and Apply.

The checkbox must be available in the effect settings panel and its state must be remembered separately for each effect.

Auto Apply must not trigger repeatedly for every pointer-move event. Apply once per completed stroke, or use an equivalent controlled interaction that avoids excessive processing and History entries.

The feature must respect the effect's existing application semantics and must not be available for full-image or gesture-based effects that do not use a brush selection.

### 5.3 Gesture-based effects

Some effects require direct canvas interaction rather than a conventional selection.

Examples include Block Transform Copy and Swap, where the user selects a source region and performs a drag gesture to define the destination.

Do not force these effects into the ordinary selection-based workflow.

Inspect each existing Block Transform operation and preserve its actual gesture semantics.

Block Shuffle is selection-based, not gesture-based.

The application mode must be defined per operation, not inferred from the name of an effect family.

## 6. Selection and Brush UX

### 6.1 Selection appearance

- Display the selection as an outline only.
- Do not use translucent fill, because it obscures the image and effect preview.
- Use a clearly visible contrasting dashed or marching-ants outline.
- Keep the Brush cursor visually separate from the selection outline.

The displayed selection geometry must correspond to the actual mask used by the processing engine, including DCT/MCU snapping.

Do not display a raw pointer outline if the actual mask has been snapped to different boundaries.

### 6.2 Brush controls

When Brush is active, display its controls in the horizontal canvas toolbar:

- Brush size.
- Snapping mode.

Brush size is expressed in image pixels.

Snapping is a separate setting. Preserve the existing supported snapping modes, including DCT block and MCU snapping where applicable.

Do not merge brush size and snapping into one control.

### 6.3 Selection persistence

Preserve the existing selection lifecycle and Restore Selection functionality.

Applying an effect may clear the current draft selection according to the existing application behavior. Do not change this behavior without inspecting its implementation and explicitly addressing compatibility.

## 7. Component visualization: Y / Cb / Cr

Keep the existing compact segmented component selector:

`Y | Cb | Cr`

The selected component determines the component targeted by the effect.

### 7.1 Visual representation

Show a fragment or view of the current photograph decomposed into the selected component.

Do not use abstract icons or unrelated sample images.

The component visualization must correspond to the currently loaded photograph.

Switching between Y, Cb and Cr changes the displayed component representation.

### 7.2 Explanation

Show a static explanation of all three components at once. Do not dynamically replace the explanatory text when the selected component changes.

Use technically accurate descriptions:

- **Y:** luminance component, representing brightness information.
- **Cb:** blue-difference chroma component.
- **Cr:** red-difference chroma component.

Explain that chroma components represent color-difference information and may have lower spatial resolution due to chroma subsampling.

Do not describe Cb and Cr as simple independent blue/yellow and red/green image channels.

Do not assume that JPEG component identifiers alone establish Y/Cb/Cr semantics. Respect the actual color-space interpretation available in the document model.

## 8. DCT frequency visualization

Keep the existing frequency-band segmented control.

The visualization is informational, not an interactive coefficient selector.

### 8.1 Matrix

Display an 8×8 matrix representing the actual two-dimensional DCT basis functions.

Each cell must visualize the corresponding cosine basis function for coefficient coordinates `(u, v)`.

- Horizontal matrix coordinate: `u`, horizontal spatial frequency.
- Vertical matrix coordinate: `v`, vertical spatial frequency.
- `(0, 0)` represents DC.
- Increasing coordinates represent increasing spatial frequencies.

Render the actual cosine patterns, including alternating positive and negative regions. Do not substitute generic colored squares or frequency labels.

### 8.2 Selected frequency band

Highlight the cells belonging to the currently selected frequency band.

Dim the remaining cells without hiding their structure.

Use the actual frequency-band definitions of the relevant operation. Do not assume that every operation uses identical frequency cutoffs.

If the existing operation uses the following ranges, preserve them:

- DC: `(0, 0)`.
- AC Low: `u + v = 1–2`.
- AC Mid: `u + v = 3–5`.
- AC High: `u + v = 6–14`.

Other operations may have their own cutoffs or fixed frequency behavior. The visualization must reflect actual operation semantics rather than applying these ranges universally.

### 8.3 Hover information

When the pointer hovers over a matrix cell:

- Show an enlarged visualization of that cell's cosine basis function.
- Display its `(u, v)` coordinates.
- Identify whether the coefficient is DC or AC.
- Keep the interaction informational; clicking a cell must not change the selected frequency range.

## 9. Random seed controls

For effects that use randomness:

- Keep the numeric seed visible in the regular settings panel.
- Keep a Randomize button visible.
- Put small copy icon next to the seed value.
- Put direct numeric seed editing inside Advanced settings.
- Preserve the exact seed in the applied History operation.

A previously applied operation must remain reproducible even if the current effect seed is randomized or edited later.

## 10. Preview and Apply behavior

### 10.1 Hybrid preview strategy

Use a hybrid strategy:

- Lightweight effects: update preview automatically when relevant parameters change.
- Expensive effects: require an explicit Preview action.

The classification must be based on actual operation cost and the existing processing pipeline, not arbitrary UI assumptions.

Use debouncing or cancellation where appropriate to avoid unnecessary work.

### 10.2 Stale preview state

The interface must make it clear when the visible preview does not correspond to the current parameter values.

A user must not mistake an old preview for the result of newly changed parameters.

### 10.3 After Apply

After an operation is successfully applied:

- Keep the effect selected.
- Preserve its current settings.
- Show the resulting applied image in the canvas preview.
- Record the operation in History using an immutable parameter snapshot.
- Do not silently reset the effect configuration.

Preserve the existing error and recovery behavior. A failed operation must not be represented as successfully applied.

## 11. Advanced settings

Advanced settings are presented as a collapsible section inside the current effect's settings panel.

They contain less frequently used or lower-level controls.

Examples:

- Exact numeric seed editing.
- Low-level technical parameters.
- Other controls that are currently implemented but are not necessary for the primary workflow.

Do not move frequently used creative controls into Advanced merely to reduce panel size.

Do not invent new advanced capabilities as part of this redesign.

## 12. History

History remains in the lower section of the right panel.

Preserve all existing functionality and data semantics, including:

- Applied operation records.
- Undo / redo integration.
- Existing operation controls.
- Restore Selection.
- Exact parameters and seeds associated with each applied operation.

History records must not be coupled to the currently displayed effect settings.

## 13. Explicitly out of scope

Do not implement these items in this iteration:

- User-created effects.
- User effect presets or saved custom brushes.
- Search within the effects catalog.
- Collapsible effect categories.
- Interactive coefficient selection by clicking DCT matrix cells.
- Selection dimensions and affected-block counters.
- A new selection restoration mechanism.
- A new operation history implementation.
- A new JPEG processing engine.
- New glitch algorithms or effects.

This task is focused on the interface and interaction model, not expanding the application's creative or JPEG-processing capabilities.

## 14. Implementation approach

Implement incrementally.

Recommended sequence:

1. Inspect the current application and map existing components to the target layout.
2. Implement the three-column workspace and independent right-panel zones.
3. Implement the Effects catalog and effect selection behavior.
4. Implement effect-specific settings persistence.
5. Implement application-mode-aware selection and gesture requirements.
6. Refine Brush, Select and canvas toolbar behavior.
7. Implement the component visualization.
8. Implement the DCT basis-function matrix and hover details.
9. Refine seed controls and Advanced settings.
10. Implement the hybrid preview behavior and post-Apply state.
11. Validate History and selection restoration integration.
12. Run tests and perform a manual browser review.

Do not attempt a large one-shot rewrite.

Before changing shared state management, identify the existing source of truth and avoid introducing duplicated state.

## 15. Acceptance criteria

The redesign is complete when:

### Layout
- [ ] The workspace has a full Effects panel on the left.
- [ ] The canvas is centered.
- [ ] The right panel contains independently scrollable Effect Settings and History zones.
- [ ] Canvas tools and context-sensitive controls share a horizontal toolbar.

### Effects
- [ ] The Effects catalog remains visible when selecting an effect.
- [ ] Only one effect settings panel is displayed at a time.
- [ ] Switching effects restores each effect's previous settings.
- [ ] Applying an effect does not reset its settings.
- [ ] Current settings do not mutate existing History operations.

### Application modes
- [ ] Full-image effects do not require a selection.
- [ ] Selection-based effects show settings without a selection but disable Preview and Apply.
- [ ] The interface explains how to create the required selection.
- [ ] Brush and Select receive a subtle visual emphasis when relevant.
- [ ] Gesture-based effects retain their individual canvas interaction semantics.

### Selection and Brush
- [ ] Selection is shown as an outline without translucent fill.
- [ ] Brush cursor is visually distinct from selection.
- [ ] Brush size is expressed in image pixels.
- [ ] Snapping is controlled separately.
- [ ] The displayed mask matches the actual snapped mask.

### Components and DCT
- [ ] Y / Cb / Cr selector remains compact.
- [ ] Component visualization uses the current photograph.
- [ ] Static explanatory text describes all three components.
- [ ] The DCT matrix shows actual two-dimensional cosine basis functions.
- [ ] The matrix highlights the selected frequency band according to actual operation semantics.
- [ ] Hover displays an enlarged basis function and `(u, v)` information.
- [ ] Clicking the matrix does not alter the selected band.

### Seed and preview
- [ ] Seed remains visible.
- [ ] Copy uses a compact icon.
- [ ] Randomize remains visible where applicable.
- [ ] Exact numeric seed editing is in Advanced.
- [ ] Applied operations preserve their exact seeds.
- [ ] Lightweight and expensive effects use the appropriate preview strategy.
- [ ] Stale preview state is communicated clearly.
- [ ] After Apply, the selected effect and its settings remain intact.

### Regression and reliability
- [ ] Existing JPEG processing behavior is unchanged.
- [ ] Original image bytes remain recoverable and unmodified.
- [ ] Undo / redo continue to work.
- [ ] History operation snapshots remain correct.
- [ ] Restore Selection continues to work.
- [ ] Project save/reopen behavior remains compatible.
- [ ] Existing tests pass, and new UI behavior has appropriate tests.
- [ ] The application builds successfully.

## 16. Final instruction to the coding agent

Treat this document as the target UX specification, but treat the existing codebase as the source of truth for current implementation details.

Do not guess how an effect works based on its name.

Inspect the relevant implementation before changing its controls or interaction model.

Do not silently remove existing capabilities.

If a requirement cannot be implemented without changing core processing behavior, changing serialized project data, or breaking existing history semantics, stop and report the issue before proceeding.

At the end, provide:

1. A summary of implemented changes.
2. A list of modified files and components.
3. Any deviations from this specification and their reasons.
4. Tests executed and their results.
5. Known limitations or remaining work.
