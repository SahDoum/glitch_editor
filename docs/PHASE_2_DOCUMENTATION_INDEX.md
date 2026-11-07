# Phase 2 Documentation Index

**Purpose:** Navigate between documentation files and understand their relationships.  
**Scope:** Phase 2 — Interface Refinement & Glitch Research

---

## 📚 Documentation Map

### Getting Started

| Document | Purpose | Audience | Read Time |
|----------|---------|----------|-----------|
| **[ROADMAP.md](./ROADMAP.md)** | Phase 2 sequence, milestones, acceptance criteria | Everyone | 10 min |
| **[INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md)** | Quick lookup: tools, parameters, shortcuts | Developers during implementation | 5 min |
| **[MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md)** | Complete interface analysis and terminology standards | Planning & design reviews | 30 min |

### For Development

| Document | Purpose | Use When | Status |
|----------|---------|----------|--------|
| **[INTERFACE.md](./INTERFACE.md)** | Current interface behavior (existing implementation) | Designing changes or understanding current state | Current |
| **[INTERFACE_DIRECTION.md](./INTERFACE_DIRECTION.md)** | Planned interface improvements and design decisions | Reviewing proposed changes before implementation | To be updated during M1 |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Module boundaries, responsibilities, data flow | Understanding code structure before refactoring | Current |
| **[PRODUCT.md](../PRODUCT.md) (root level)** | Product scope, principles, safety rules | Understanding product constraints | Current |

### For Research & Experiments

| Document | Purpose | Content Type | Status |
|----------|---------|--------------|--------|
| **[GLITCH_CATALOG.md](./GLITCH_CATALOG.md)** | Research candidates, hypotheses, visual effects | Ideas & research questions | Research backlog |
| **[GLITCH_EXPERIMENTS.md](./GLITCH_EXPERIMENTS.md)** | Verified experiments with results and fixtures | Documented actual experiments (Milestone 4 onwards) | To be populated in M4 |
| **[MOSH_TECHNICAL_REVIEW.md](./MOSH_TECHNICAL_REVIEW.md)** | Analysis of datamoshing vs JPEG glitch techniques | Reference / context | Historical |

### For Testing & Quality

| Document | Purpose | Read | Status |
|----------|---------|------|--------|
| **[JPEG_TEST_STRATEGY.md](./JPEG_TEST_STRATEGY.md)** | Correctness testing, regression tests, fixtures | Before writing tests | Current |
| **[DECISIONS.md](./DECISIONS.md)** | Scope changes, architectural decisions, rationale | When understanding why decisions were made | To be updated during development |

### Reference

| Document | Purpose | Type |
|----------|---------|------|
| **[AGENTS.md](./AGENTS.md)** | Agent definitions and capabilities | Reference (if using agents in workflow) |
| **[DEVELOPMENT.md](./DEVELOPMENT.md)** | Development setup and workflow | Setup guide |
| **[UX_SIMPLIFICATION_PROPOSAL.md](./UX_SIMPLIFICATION_PROPOSAL.md)** | Historical UX analysis and proposals | Archived ideas (reference only) |
| **[ROADMAP_PHASE_1_ARCHIVE.md](./ROADMAP_PHASE_1_ARCHIVE.md)** | Phase 1 roadmap (completed) | Historical reference |
| **[MY_NOTES.md](./MY_NOTES.md)** | Scratchpad for ongoing notes | Personal notes (varies) |

---

## 🔄 Document Relationships

```
ROADMAP.md (Phase 2 sequence)
    ↓
    ├─→ MILESTONE_0_INVENTORY.md ✅ (Completed: Full inventory)
    │       ↓
    │       └─→ INTERFACE_INVENTORY_QUICK_REFERENCE.md (Quick lookup)
    │
    ├─→ INTERFACE.md (Current state)
    │       ↓
    │       └─→ INTERFACE_DIRECTION.md (Planned changes)
    │
    ├─→ ARCHITECTURE.md (Module design)
    │
    ├─→ PRODUCT.md (Product scope & principles)
    │
    ├─→ GLITCH_CATALOG.md → GLITCH_EXPERIMENTS.md (M4 research)
    │
    ├─→ DECISIONS.md (Scope changes)
    │
    └─→ JPEG_TEST_STRATEGY.md (Testing approach)
```

---

## 📋 How to Use This Index

### For a New Developer Joining Phase 2

1. **Start here:** [ROADMAP.md](./ROADMAP.md) (understand the plan)
2. **Then read:** [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) (learn the tools)
3. **For details:** [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md) (deep dive into current state)
4. **For implementation:** [ARCHITECTURE.md](./ARCHITECTURE.md) (understand code structure)
5. **For testing:** [JPEG_TEST_STRATEGY.md](./JPEG_TEST_STRATEGY.md) (how to test changes)

### For Implementing Milestone 1

1. Review [ROADMAP.md](./ROADMAP.md) § Milestone 1 (acceptance criteria)
2. Check [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) § Milestone 1 Quick Tasks (what to rebuild)
3. Consult [INTERFACE.md](./INTERFACE.md) for current behavior
4. Update [INTERFACE_DIRECTION.md](./INTERFACE_DIRECTION.md) with planned changes
5. After implementation, update [INTERFACE.md](./INTERFACE.md)
6. Record decisions in [DECISIONS.md](./DECISIONS.md) if scope changed

### For Glitch Research (Milestone 4)

1. Start with [GLITCH_CATALOG.md](./GLITCH_CATALOG.md) (research questions)
2. Design experiments (state hypothesis, mechanism, fixtures)
3. Implement and run
4. Document results in [GLITCH_EXPERIMENTS.md](./GLITCH_EXPERIMENTS.md) (include evidence)
5. Reference [JPEG_TEST_STRATEGY.md](./JPEG_TEST_STRATEGY.md) for testing approach

### For Design Reviews

1. Check [INTERFACE_DIRECTION.md](./INTERFACE_DIRECTION.md) (planned improvements)
2. Reference [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md) (current state as baseline)
3. Verify against [PRODUCT.md](../PRODUCT.md) principles
4. Consult [ROADMAP.md](./ROADMAP.md) acceptance criteria

---

## 🎯 Key Files by Milestone

### Milestone 0 (✅ Complete)
- ✅ [MILESTONE_0_INVENTORY.md](./MILESTONE_0_INVENTORY.md) — Full inventory
- ✅ [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) — Quick reference
- ✅ [ROADMAP.md](./ROADMAP.md) — Restructured with task breakdowns

### Milestone 1 (📋 Planned)
- → [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) § Milestone 1 Quick Tasks
- → [INTERFACE_DIRECTION.md](./INTERFACE_DIRECTION.md) — To be updated with M1 design decisions
- → [INTERFACE.md](./INTERFACE.md) — To be updated after M1 implementation

### Milestone 2–6 (📋 Planned)
- → [ROADMAP.md](./ROADMAP.md) — Detailed acceptance criteria per milestone
- → [DECISIONS.md](./DECISIONS.md) — Record decisions as you go
- → [GLITCH_EXPERIMENTS.md](./GLITCH_EXPERIMENTS.md) — For M4 research results

---

## 📝 Updating Documentation

### When Starting a Milestone

1. Update status badge in [ROADMAP.md](./ROADMAP.md) from `📋 Planned` to `🔄 In Progress`
2. Reference [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) for existing state
3. Plan changes → update [INTERFACE_DIRECTION.md](./INTERFACE_DIRECTION.md)

### When Implementing Changes

1. Record design decisions in [INTERFACE_DIRECTION.md](./INTERFACE_DIRECTION.md)
2. Update [INTERFACE.md](./INTERFACE.md) as behavior changes
3. Document architectural changes in [ARCHITECTURE.md](./ARCHITECTURE.md) if needed
4. Log scope changes in [DECISIONS.md](./DECISIONS.md)

### When Completing a Milestone

1. Update status badge in [ROADMAP.md](./ROADMAP.md) to `✅ Complete`
2. Update [INTERFACE.md](./INTERFACE.md) to reflect new behavior
3. Update [INTERFACE_INVENTORY_QUICK_REFERENCE.md](./INTERFACE_INVENTORY_QUICK_REFERENCE.md) if UI changed significantly
4. Document all decisions made

---

## 🔗 External References

- **Repository:** [SahDoum/glitch_editor](https://github.com/SahDoum/glitch_editor)
- **Phase 1 archive:** [ROADMAP_PHASE_1_ARCHIVE.md](./ROADMAP_PHASE_1_ARCHIVE.md)
- **Historical analysis:** [MOSH_TECHNICAL_REVIEW.md](./MOSH_TECHNICAL_REVIEW.md)

---

**Index version:** 1.0  
**Last updated:** November 8, 2024  
**Scope:** Phase 2 — Interface Refinement & Glitch Research
