# JPEG Glitch Editor — Interface Direction

**Purpose:** Define how the existing interface should evolve.  
**Priority:** Interface usability comes before expanding the glitch catalog.

## 1. Design goal

The application should feel like an accessible visual editor, not like a collection of debugging panels.

Users should be able to:

- choose a tool;
- understand what it changes;
- adjust its parameters;
- see the result;
- compare it with the original;
- commit the operation;
- undo or modify it later.

The interface should expose JPEG-specific concepts when they are useful, but should not require users to understand JPEG internals before they can use a tool.

The guiding principle is:

**Simple controls, visible consequences, technically honest explanations.**

## 2. Remove the vague Experiment browser concept

The proposed "Experiment browser" is not a clear user-facing feature and should not be implemented as a separate interface at this stage.

The word *experiment* has two different meanings in this project:

1. **Research experiment:** a documented test performed during development to establish whether a proposed mechanism produces a particular visual result.
2. **User operation:** an action the user applies to an image, such as zeroing coefficients, modifying a quantization table, or corrupting a scan.

These should not be confused.

Research experiments belong in `GLITCH_EXPERIMENTS.md`. User-facing operations belong in the editor's tools and operation history.

A future preset gallery may be useful, but it should be designed as a way to discover and apply useful combinations of tools, not as a browser for internal research records.

## 3. Main interface priorities

The most important improvements are:

1. Tool parameter panels.
2. Preview and before/after comparison.
3. Clear component and frequency selection.
4. Clearer explanations of existing concepts.
5. Consistent controls across tools.

Do not start by adding another navigation layer or a new top-level browser.

## 4. Tool parameter panels

### 4.1 General control rules

Prefer:

- radio buttons for mutually exclusive choices;
- segmented controls for a small number of alternatives;
- sliders for bounded numeric values;
- checkboxes for independent on/off options;
- a dedicated button for random generation;
- dropdowns only when the number of options is too large for a direct choice.

Avoid making users open a dropdown just to choose between two or three common options.

Numeric inputs can remain available where exact values are important, but should not be the only way to adjust common parameters.

Every control should have:

- a short visible label;
- a useful default;
- a clear indication of the selected value;
- a concise explanation or tooltip where the meaning is not obvious.

### 4.1.1 Button-like choices and multi-selection

Small mutually exclusive option sets should look like selectable buttons:
give the selected option a filled background, accent border, and check mark;
keep focus clearly visible; and allow the options to wrap or stack on narrow
screens. Use native radio-group keyboard behavior and semantics even when the
radio indicator itself is visually hidden. Do not rely on color alone for the
selected state.

Use the same visual language for multi-select choices only when the operation
actually accepts multiple values; those controls must use checkbox semantics
and allow more than one selected option. Do not convert an operation's
single-target behavior into multiple targeting just to make its selector look
consistent.

The current coefficient, block, and inspector controls select one JPEG
component because their operations take one component index. Multi-component
editing is a future operation-model change requiring explicit validation,
mask mapping, history, and project serialization support. Y/Cb/Cr labels are
conventional hints only; component IDs and sampling factors remain visible.

### 4.2 Random seed

Randomized tools should expose the seed in a consistent way.

Suggested interaction:

- show the current unsigned 32-bit seed;
- provide a **Randomize** button to generate a new seed;
- allow manual editing or copying of the seed where appropriate;
- changing the seed should produce a reproducible result;
- reusing the same seed and parameters should reproduce the same operation.

The randomize button must not silently change the seed during unrelated parameter changes.
The implemented randomize button changes only the seed field and ensures the
new value differs from the current value.

## 5. Frequency selection

### 5.1 Shared frequency selector

DC and AC frequency selection should use a common control model across tools wherever the underlying operation supports it.

For coefficient operations, show Operation first, followed by one combined
radio group whose choices depend on that operation:

- **DC** — available to Zero, Scale, and Randomize;
- **AC Low**, **AC Mid**, **AC High**, **AC All** — available to Zero,
  Scale, Randomize, and Invert AC;
- **Isolate band** exposes AC Low/Mid/High only: DC is not an AC band, and
  AC All would leave no coefficients outside the selected range to clear;
- **DC offset** has no range selector because it always targets DC.

The exact mapping of AC bands to coefficient coordinates must be defined consistently in the implementation and documented. Do not let different tools silently use different definitions for the same labels.

Where an operation supports selecting several bands simultaneously, allow multiple selections rather than forcing the user to configure them one at a time.

The selector should be reusable across coefficient-oriented tools.

Brush and Select author a component-independent spatial mask and must not
have their own Color component selector. The JPEG effect target selector
remains in the effect settings; DCT snapping follows that target. An applied
JPEG operation still records its component target.

### 5.2 Horizontal and vertical frequencies

The JPEG DCT uses two frequency coordinates:

- **u — horizontal frequency**
- **v — vertical frequency**

For the initial interface, use simple selectors for horizontal and vertical frequencies.

Defaults:

- horizontal frequencies: selected;
- vertical frequencies: selected.

The initial control should make it easy to include both directions or choose one direction independently.

Do not expose a complicated matrix editor as the default control. More detailed frequency-coordinate selection can be introduced later as an advanced mode.

### 5.3 Frequency icons

Each frequency choice should be accompanied by a small visual representation of the corresponding JPEG DCT basis pattern.

The icon should communicate the spatial frequency structure:

- low frequency: broad, slowly changing pattern;
- mid frequency: more frequent changes;
- high frequency: fine, rapidly alternating pattern.

For individual u/v choices, use the actual two-dimensional basis pattern rather than an arbitrary decorative symbol.

The visual should be small enough to fit beside the control label, but clear enough to distinguish frequency patterns.

## 6. Component selection

Use JPEG component names directly:

- **Y** — brightness and much of the visible contours and image structure;
- **Cb** — blue-difference color information;
- **Cr** — red-difference color information.

The explanations should be visible near the controls, not hidden in technical documentation.

### 6.1 Visual presentation

Each component should have:

- its label: Y, Cb, or Cr;
- a short human-readable explanation;
- a consistent visual tint;
- a radio-button or segmented-button selection.

Suggested descriptions:

- **Y — Brightness / contours**
- **Cb — Blue–yellow color information**
- **Cr — Red–green color information**

The color tint is an interface cue, not a literal representation of the component's pixel values. Keep the labels and explanations available so that color alone is never the only way to identify a component.

### 6.2 Selection behavior

For a tool that operates on exactly one component, use radio-button behavior.

For a tool that can operate on multiple components simultaneously, use a multi-select control with the same visual language.

Do not force every operation into single-component selection if the underlying operation supports multiple components.

### 6.3 Actual JPEG component mapping

The UI must use the actual component metadata from the loaded JPEG.

Do not assume that component index 0 always means Y or that indexes 1 and 2 always mean Cb and Cr without checking the JPEG's frame and component identifiers.

For common three-component JPEGs, Y/Cb/Cr is an appropriate user-facing presentation. If a file has an unusual component arrangement, the interface should not silently mislabel it.

## 7. Quantization tables: DQT0 and DQT1

The interface should avoid presenting DQT0 and DQT1 as unexplained technical identifiers.

Where the JPEG metadata confirms the common assignment, show:

- **DQT 0 — Brightness (Y)**
- **DQT 1 — Color (Cb/Cr)**

However, DQT table IDs are not intrinsically brightness and color. Each frame component specifies which quantization table it uses.

Therefore:

- inspect the component-to-table assignment in the loaded JPEG;
- display the human-readable role based on that assignment;
- retain the numeric table ID as secondary technical information;
- support unusual or shared table assignments without incorrect labels.

For example, if Y uses table 0 and both chroma components use table 1, the UI can show the common brightness/color labels. If the file uses a different mapping, display the actual mapping instead.

## 8. Preview and comparison

Preview and comparison should be central to the application.

### 8.1 Before/after modes

Provide convenient ways to compare:

- original image;
- current processed result;
- before/after split;
- draggable wipe divider.

A user should be able to inspect the result without losing the current tool settings.

### 8.2 Live parameter preview

When a parameter changes:

- update the preview;
- make it clear that the preview is provisional;
- avoid adding a new history entry for every slider movement;
- allow the user to commit the final adjustment as one operation.

For expensive operations, use debouncing or progressive preview updates.

### 8.3 Preview failure

Some JPEG operations may produce files that a decoder cannot display.

The interface should distinguish:

- valid preview;
- preview unavailable because decoding failed;
- operation completed but produced a result with warnings;
- operation could not be applied.

Never replace the original image with a failed or undecodable result.

### 8.4 Comparison with history

The user should be able to compare the current result with the original and, where practical, with a previous state in the operation history.

The preview should make it clear which state is being shown.

## 9. Clarify existing interface concepts

Some existing concepts need a product-level review before they receive more UI.

### 9.1 Multi-step recipes

The purpose of Multi-step recipes must be clarified.

Possible interpretation: a recipe is a saved sequence of several operations with their parameters and order.

If this is what the feature does, the interface should explain:

- that a recipe contains multiple operations;
- which operations it contains;
- the order in which they are applied;
- the parameters of each step;
- whether individual steps can be disabled, edited, or reordered;
- whether the recipe can be applied as one undoable action or as several history entries.

A recipe should not be presented as an opaque magic effect.

Before redesigning it, inspect the actual implementation and determine whether recipes are:

- predefined combinations;
- user-created operation sequences;
- reusable presets;
- a separate processing pipeline.

Do not assume these concepts are interchangeable.

### 9.2 Presets

A preset is a saved parameter configuration for one tool or a named combination of operations.

The UI should distinguish a single-tool preset from a multi-step recipe.

### 9.3 Operation history

History describes what has already been applied.

It should remain distinct from presets and recipes:

- **Tool:** an operation the user can configure.
- **Preset:** a saved configuration.
- **Recipe:** a sequence of operations, if supported by the implementation.
- **History:** operations already applied to the current document.

### 9.4 Masks and selections

The interface should make clear whether a mask controls:

- which blocks are affected;
- which MCUs are affected;
- which image region is used to derive a coefficient mask;
- or which parts of a visual preview are shown.

Avoid using the generic word "selection" when the actual behavior is more specific.

## 10. Suggested tool-panel structure

A consistent tool panel can follow this order:

1. **Tool name** — short description of the effect or operation.
2. **Target** — component, frequency bands, blocks, or scan data.
3. **Parameters** — sliders, radio buttons, and other controls.
4. **Randomness** — seed and Randomize button, if applicable.
5. **Preview** — immediate visual feedback.
6. **Actions** — Apply/Commit and Cancel/Reset.

Not every tool needs every section. Do not show irrelevant controls just to maintain visual uniformity.

## 11. Progressive disclosure

The default interface should expose the controls needed for the common use case.

Advanced parameters can be placed behind a clearly named expandable section.

Examples:

- common DC/AC band selection first; detailed coefficient coordinates later;
- simple horizontal/vertical frequency selectors first; advanced u/v matrix selection later;
- common component choices first; unusual component metadata in an information panel;
- common DQT controls first; raw table inspection in an advanced view.

Progressive disclosure should reduce initial complexity without hiding important consequences or changing the underlying operation.

## 12. Implementation order

### Step 1 — Inventory

Map existing tools to their parameters and current controls.

### Step 2 — Shared controls

Implement reusable components for:

- radio/segmented choices;
- sliders;
- seed display and Randomize action;
- frequency-band selection;
- horizontal/vertical frequency selection;
- Y/Cb/Cr component selection.

### Step 3 — Redesign existing tool panels

Migrate existing tools to the shared controls without changing their processing behavior.

### Step 4 — Preview and comparison

Improve before/after comparison and provisional parameter previews.

### Step 5 — Clarify recipes and other concepts

Review the actual implementation and decide how Multi-step recipes, presets, masks, and history should be presented.

### Step 6 — Usability review

Test the revised controls with users who do not know JPEG internals.

Check whether they can understand:

- what a tool changes;
- which part of the JPEG it affects;
- how to adjust its parameters;
- how to compare the result;
- how to reproduce the result.

## 13. Non-goals

This phase is not intended to:

- rebuild the application from scratch;
- replace the existing JPEG processing engine;
- hide all technical information;
- introduce a separate Experiment browser;
- turn JPEG operations into ordinary RGB filters;
- add new glitch algorithms before improving the existing interface;
- expose every low-level JPEG parameter in the default view.

## 14. Definition of success

The interface is successful when a user can select a tool, understand its target, adjust the parameters, see the result, compare it with the original, and commit or discard the operation without having to understand the internal JPEG implementation.

Advanced users must still be able to inspect the technical details and reproduce the result.
