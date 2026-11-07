# JPEG Glitch Editor — Phase 2 Roadmap

**Phase:** Interface Refinement & Glitch Research  
**Status:** Planned  
**Starting point:** Phase 1 implementation is complete. Existing tools and operations are the baseline; this phase improves their usability before expanding the creative capabilities.

## 1. Goal

Turn the existing JPEG Glitch Editor into a more accessible and understandable creative tool without hiding its technical nature.

The work follows this order:

1. Make the existing interface and tools understandable.
2. Improve parameter controls and the preview/comparison workflow.
3. Clarify existing features whose purpose or behavior is not obvious.
4. Audit what the existing operations can already produce.
5. Research and implement new JPEG glitch techniques.
6. Organize the resulting tools into a coherent creative workflow.

The first priority is not adding more effects. It is making the existing capabilities easier to discover, understand, control, and compare.

## 2. Development principles

- **Interface before research expansion.** Improve the usability of existing tools before starting a large round of new glitch experiments.
- **Preserve existing functionality.** Do not rebuild completed Phase 1 milestones or reimplement existing operations under new names.
- **Prefer direct controls.** Use radio buttons, segmented controls, and sliders where they make a choice easier to understand than a dropdown or numeric input.
- **Show the visual meaning of technical parameters.** Use small visual explanations, labels, and previews.
- **Keep technical accuracy.** UI simplification must not misrepresent JPEG internals.
- **Preview before commit.** Users should be able to see the result of changing parameters before adding the operation to the history.
- **Reproducibility.** Random operations retain an explicit seed and provide a convenient way to generate a new one.
- **Separate effects from mechanisms.** A visual effect is not the same thing as the JPEG operation that produces it.
- **Record uncertainty.** A proposed effect remains a hypothesis until it has been tested and documented.

## 3. Milestones

### Milestone 0 — Interface inventory and terminology

Review the current application and document:

- every existing tool and its parameters;
- every dropdown, numeric input, checkbox, and other control;
- the meaning of each parameter in JPEG terms;
- unclear or overlapping concepts;
- the behavior of Multi-step recipes and other higher-level workflows;
- which controls can be simplified without changing the underlying operation.

Deliverables:

- inventory of existing tools and controls;
- terminology decisions;
- list of unclear interface elements;
- list of controls to redesign.

Do not remove a feature merely because its current interface is confusing. First establish what it does and whether it is still useful.

### Milestone 1 — Tool control redesign

Redesign the parameter panels of existing tools.

Priorities:

- replace dropdowns with radio-button or segmented-button choices when the number of options is small;
- replace numeric inputs with sliders when the parameter has a meaningful bounded range;
- provide a randomize button for generation seeds;
- make common frequency selections consistent across tools;
- use the same component-selection model across tools;
- use visual labels and explanations for JPEG-specific parameters.

The first version of the redesigned controls should favor clarity over exposing every possible low-level parameter.

### Milestone 2 — Preview and comparison workflow

Improve the relationship between parameter editing and the image preview.

Requirements:

- show the original and processed image in a convenient comparison mode;
- support a before/after split or wipe comparison;
- allow switching between original and result;
- update the preview when parameters change;
- make it clear whether the current preview represents an uncommitted adjustment or an operation already added to history;
- preserve the ability to undo and redo committed operations.

The preview should be central to the editing workflow, not a secondary diagnostic feature.

### Milestone 3 — Clarify existing workflows and concepts

Review features whose purpose is not obvious from their names or current presentation.

In particular:

- Multi-step recipes;
- presets and saved parameter combinations;
- masks and selections;
- operation history and operation stack;
- the difference between applying an operation and combining several operations.

For each feature, decide whether to:

1. keep it and explain it better;
2. rename it;
3. redesign its interaction;
4. merge it with another concept;
5. remove it if it has no clear user-facing purpose.

Do not assume that Multi-step recipes should remain a separate top-level feature. First establish what user problem they solve.


### Milestone 4 — Glitch research and new experiments

Use `GLITCH_CATALOG.md` as the research backlog.

Investigate effects by mechanism:

- coefficient and quantization changes;
- block and MCU transformations;
- component-specific operations;
- entropy-coded scan manipulation;
- marker and structural changes;
- raw-byte manipulation.

Each experiment must have:

- a clearly stated hypothesis;
- a description of the JPEG data being changed;
- an implementation or test procedure;
- reproducible parameters;
- example inputs and outputs;
- decoder compatibility observations;
- a conclusion: verified, rejected, or requiring further work.

Do not implement an effect solely because its name sounds promising. Before implementing a new glitch, check whether the desired visual result can be achieved using existing operations or their combinations.

### Milestone 5 — New creative tools and presets

Turn verified and useful techniques into user-facing tools.

Requirements:

- consistent parameter controls;
- sensible defaults;
- clear descriptions of what the tool changes;
- preview and comparison;
- deterministic random behavior where applicable;
- integration with history and undo/redo;
- export through the existing JPEG pipeline.

A preset may combine several operations, but its behavior must remain inspectable and reproducible.

### Milestone 6 — Creative workflow refinement

After the tools and experiments have stabilized:

- improve the organization of the toolbar;
- group related tools;
- refine presets and multi-operation workflows;
- improve the visual hierarchy of the interface;
- remove redundant controls;
- document the final user workflow.

## 4. Definition of done

Phase 2 is complete when:

- existing tools have a consistent and understandable control language;
- common parameters can be adjusted without navigating confusing dropdowns;
- preview and before/after comparison are part of the normal workflow;
- unclear existing concepts have been reviewed and resolved;
- the existing operations have been visually audited;
- new glitch effects are documented with evidence rather than assumptions;
- verified new tools integrate with history, preview, and export;
- the interface explains the relevant JPEG concepts without requiring users to understand the JPEG standard first.

## 5. Documentation responsibilities

- `ROADMAP.md` — sequence and scope of Phase 2.
- `GLITCH_CATALOG.md` — possible visual effects, mechanisms, hypotheses, and research status.
- `GLITCH_EXPERIMENTS.md` — actual experiments performed and their reproducible results.
- `INTERFACE.md` — description of the interface that currently exists.
- `INTERFACE_DIRECTION.md` — intended interface improvements and design decisions.
- `PRODUCT.md` — product scope and principles.
- `ARCHITECTURE.md` — technical boundaries and module responsibilities.
- `JPEG_TEST_STRATEGY.md` — correctness and regression testing.

Do not use `GLITCH_EXPERIMENTS.md` as a list of ideas. It should describe experiments that have actually been performed.

Do not use `INTERFACE.md` as a wishlist. It should describe implemented behavior.
