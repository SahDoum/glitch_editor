# JPEG Glitch Editor — Phase 2 Roadmap

**Phase:** Interface Refinement & Glitch Research  
**Status:** Active  
**Starting point:** Phase 1 implementation is complete. Existing tools and operations are the baseline; this phase improves their usability before expanding the creative capabilities.

**Quick reference:** [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) — Tools, parameters, and UI elements at a glance. See [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md) for full details.

**Documentation index:** [PHASE_2_DOCUMENTATION_INDEX.md](./PHASE_2_DOCUMENTATION_INDEX.md) — Navigate between docs and understand their relationships.

**Delivery style:** Vertical slices with acceptance criteria. Each milestone delivers a runnable application with demonstrable acceptance checks. Record scope changes in `docs/DECISIONS.md`.

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

**Status:** ✅ Complete

Review the current application and document:

- [x] every existing tool and its parameters;
- [x] every dropdown, numeric input, checkbox, and other control;
- [x] the meaning of each parameter in JPEG terms;
- [x] unclear or overlapping concepts;
- [x] the behavior of Multi-step recipes and other higher-level workflows;
- [x] which controls can be simplified without changing the underlying operation.

**Deliverables:**

- [x] **MILESTONE_0_INVENTORY.md** — comprehensive inventory of existing tools and controls
- [x] Terminology decisions document (in inventory)
- [x] List of unclear interface elements (Section 11 of inventory)
- [x] List of controls to redesign (Section 12 of inventory)

**Guidelines:**

- Do not remove a feature merely because its current interface is confusing. First establish what it does and whether it is still useful.
- Inventory documents existing behavior, not desired future behavior.

### Milestone 1 — Tool control redesign

**Status:** 📋 Planned

Redesign the parameter panels of existing tools.

Priorities:

- [ ] Replace dropdowns with radio-button or segmented-button choices when the number of options is small;
- [ ] Replace numeric inputs with sliders when the parameter has a meaningful bounded range;
- [ ] Provide a randomize button for generation seeds;
- [ ] Make common frequency selections consistent across tools;
- [ ] Use the same component-selection model across tools;
- [ ] Use visual labels and explanations for JPEG-specific parameters.

**Acceptance criteria:**

- [ ] Frequency band selector (Coefficient Glitch): Use 4 radio buttons or segmented control instead of dropdown
- [ ] Glitch mode selector: Use segmented control or tabbed interface (7 modes)
- [ ] Component selector: Replace dropdown with labeled buttons or icons (Y/Cb/Cr)
- [ ] Snap option (Select tool): Use 2 radio buttons instead of dropdown
- [ ] Add "Randomize" button next to all seed inputs
- [ ] Add visual slider labels (e.g., "Soft ← Hardness → Hard")
- [ ] Separate "Core parameters" from "Advanced" sections where applicable
- [ ] All rebuilt controls tested for keyboard access and responsive layout on narrow screens
- [ ] No features removed; only UI presentation changed

**Definition of done:**

- The first version of the redesigned controls should favor clarity over exposing every possible low-level parameter.
- Existing functionality preserved exactly; only UI components replaced.
- All tests pass; acceptance checks verified on multiple screen sizes.

### Milestone 2 — Preview and comparison workflow

**Status:** 📋 Planned

Improve the relationship between parameter editing and the image preview.

Requirements:

- [ ] Show the original and processed image in a convenient comparison mode;
- [ ] Support a before/after split or wipe comparison;
- [ ] Allow switching between original and result;
- [ ] Update the preview when parameters change;
- [ ] Make it clear whether the current preview represents an uncommitted adjustment or an operation already added to history;
- [ ] Preserve the ability to undo and redo committed operations.

**Acceptance criteria:**

- [ ] Add before/after split-view comparison button (vertical or horizontal)
- [ ] Add wipe/slider tool for before/after comparison
- [ ] Add toggle button to show original vs result
- [ ] Preview updates live as parameters change (without committing to history)
- [ ] Visual indicator distinguishes "previewing" vs "applied" operations
- [ ] Undo/Redo works on committed operations only
- [ ] On narrow screens, split-view stacks vertically or offers alternative layout
- [ ] Preview state does not interfere with history navigation

**Definition of done:**

The preview should be central to the editing workflow, not a secondary diagnostic feature. Users should be able to compare before/after at any time without leaving their current tool.

### Milestone 3 — Clarify existing workflows and concepts

**Status:** 📋 Planned

Review features whose purpose is not obvious from their names or current presentation.

In particular:

- [ ] Multi-step recipes;
- [ ] presets and saved parameter combinations;
- [ ] masks and selections;
- [ ] operation history and operation stack;
- [ ] the difference between applying an operation and combining several operations.

**Acceptance criteria:**

For each feature category below, complete one of these actions:

- [ ] **Multi-step recipes:** Document intended use case and user workflow; rename if confusing; confirm it solves a distinct problem from single operations
- [ ] **Presets:** Clarify difference from recipes; document storage and restoration; add/update UI labels if unclear
- [ ] **Masks and selections:** Document pixel vs block coordinate systems; explain snap options; add visual indicators
- [ ] **Operation history:** Simplify history entry display; improve enable/disable/reorder/delete clarity; test on narrow screens
- [ ] **Combining operations:** Clarify when to use recipes vs manual sequence; document history re-evaluation order

- [ ] Each concept has clear documentation in INTERFACE.md or a separate guide
- [ ] UI labels accurately describe the concept (no longer misleading names)
- [ ] Keyboard access verified for each workflow
- [ ] No features removed without explicit user decision

**Definition of done:**

For each feature, decide whether to:

1. Keep it and explain it better (update docs + UI labels);
2. Rename it (rename consistently across UI and docs);
3. Redesign its interaction (propose changes for a later milestone);
4. Merge it with another concept (consolidate under clearer paradigm);
5. Remove it only if it has no clear user-facing purpose (requires explicit approval).

Unclear concepts are kept and clarified, not removed.


### Milestone 4 — Glitch research and new experiments

**Status:** 📋 Planned

Use `GLITCH_CATALOG.md` as the research backlog.

Investigate effects by mechanism:

- [ ] Coefficient and quantization changes;
- [ ] Block and MCU transformations;
- [ ] Component-specific operations;
- [ ] Entropy-coded scan manipulation;
- [ ] Marker and structural changes;
- [ ] Raw-byte manipulation.

**Acceptance criteria:**

For each investigated effect:

- [ ] Hypothesis is clearly stated (artifact, proposed mechanism, expected visual result)
- [ ] JPEG data being changed is documented (which coefficients, blocks, scans, or bytes)
- [ ] Implementation or test procedure is documented and reproducible
- [ ] Parameters are explicitly specified (seed, strength, component, etc.)
- [ ] Example inputs and outputs recorded (before/after fixtures)
- [ ] Decoder compatibility observations noted (does result remain decodable? which decoders?)
- [ ] Conclusion recorded: VERIFIED, REJECTED, or REQUIRING_FURTHER_WORK
- [ ] Results committed to GLITCH_EXPERIMENTS.md (not GLITCH_CATALOG.md)
- [ ] High-confidence findings mapped to potential user-facing tools

**Research discipline:**

- Do not implement an effect solely because its name sounds promising
- Before implementing a new glitch, check whether the desired visual result can be achieved using existing operations or their combinations
- Use deterministic seeds and golden fixtures to make experiments reproducible
- Do not assume a visual outcome is universal; document dependence on image content, sampling factors, and codec

**Definition of done:**

Each experiment has:

- a clearly stated hypothesis (GLITCH_CATALOG.md)
- a description of the JPEG data being changed
- an implementation or test procedure
- reproducible parameters
- example inputs and outputs
- decoder compatibility observations
- a conclusion: verified, rejected, or requiring further work
- results logged in GLITCH_EXPERIMENTS.md with citations and evidence

### Milestone 5 — New creative tools and presets

**Status:** 📋 Planned

Turn verified and useful techniques into user-facing tools.

Requirements:

- [ ] Consistent parameter controls (from Milestone 1);
- [ ] Sensible defaults;
- [ ] Clear descriptions of what the tool changes;
- [ ] Preview and comparison (from Milestone 2);
- [ ] Deterministic random behavior where applicable;
- [ ] Integration with history and undo/redo;
- [ ] Export through the existing JPEG pipeline.

**Acceptance criteria:**

For each new tool or preset:

- [ ] Tool is implemented as a user-facing control (button, panel, or mode)
- [ ] Default parameters produce a recognizable, intentional effect
- [ ] Parameter controls follow the redesigned paradigm from Milestone 1
- [ ] Description explains the JPEG mechanism and visual result
- [ ] Seed-based randomization works; "Randomize" button generates new seeds
- [ ] Operation can be added to/removed from history
- [ ] Undo/Redo works on the operation
- [ ] Exported JPEG or .jpglitch project preserves the operation
- [ ] Keyboard access verified
- [ ] Tests use golden fixtures with verified inputs/outputs

**Preset integration:**

- [ ] A preset may combine several operations
- [ ] Behavior must remain inspectable (user can see each step in history)
- [ ] Preset is reproducible from saved parameters

**Definition of done:**

A preset may combine several operations, but its behavior must remain inspectable and reproducible. Each new tool passes tests for parameter ranges, mask behavior (where applicable), history integration, and export consistency.

### Milestone 6 — Creative workflow refinement

**Status:** 📋 Planned

After the tools and experiments have stabilized:

- [ ] Improve the organization of the toolbar;
- [ ] Group related tools;
- [ ] Refine presets and multi-operation workflows;
- [ ] Improve the visual hierarchy of the interface;
- [ ] Remove redundant controls;
- [ ] Document the final user workflow.

**Acceptance criteria:**

- [ ] Toolbar is grouped by function (e.g., Manipulation, Masks, Effects, Blocks, etc.)
- [ ] Tool descriptions and icons are consistent and self-explanatory
- [ ] Presets are organized by category (e.g., "Color", "Texture", "Distortion")
- [ ] Multi-operation workflows are clearly distinguished from single operations
- [ ] Visual hierarchy guides users through expected workflows (discover → adjust → compare → apply)
- [ ] No conflicting or redundant controls for the same operation
- [ ] User documentation and tooltips describe the complete workflow

**Definition of done:**

The toolbar, presets, and workflows are organized for discoverability and learning. Users with no prior JPEG knowledge can understand what each tool does and when to use it.

---

## 4. Definition of done — Phase 2

Phase 2 is complete when:

- [x] Existing tools have been comprehensively inventoried (Milestone 0)
- [ ] Existing tools have a consistent and understandable control language (Milestone 1)
- [ ] Common parameters can be adjusted without navigating confusing dropdowns (Milestone 1)
- [ ] Preview and before/after comparison are part of the normal workflow (Milestone 2)
- [ ] Unclear existing concepts have been reviewed and resolved (Milestone 3)
- [ ] The existing operations have been visually and mechanically audited (Milestone 4)
- [ ] New glitch effects are documented with evidence rather than assumptions (Milestone 4)
- [ ] Verified new tools integrate with history, preview, and export (Milestone 5)
- [ ] The interface explains the relevant JPEG concepts without requiring users to understand the JPEG standard first (Milestone 6)

---

## 5. Documentation responsibilities

- `ROADMAP.md` — sequence and scope of Phase 2 (this file).
- `MILESTONE_0_INVENTORY.md` — comprehensive inventory of existing interface (Milestone 0 deliverable).
- `GLITCH_CATALOG.md` — possible visual effects, mechanisms, hypotheses, and research status.
- `GLITCH_EXPERIMENTS.md` — actual experiments performed and their reproducible results.
- `INTERFACE.md` — description of the interface that currently exists.
- `INTERFACE_DIRECTION.md` — intended interface improvements and design decisions (updated as milestones progress).
- `PRODUCT.md` — product scope and principles.
- `ARCHITECTURE.md` — technical boundaries and module responsibilities.
- `JPEG_TEST_STRATEGY.md` — correctness and regression testing.

**Guidelines:**

- Do not use `GLITCH_EXPERIMENTS.md` as a list of ideas. It should describe experiments that have actually been performed.
- Do not use `INTERFACE.md` as a wishlist. It should describe implemented behavior.
- Update `INTERFACE_DIRECTION.md` when planned changes are decided (before implementation).
- Record scope changes and decisions in `DECISIONS.md`.
