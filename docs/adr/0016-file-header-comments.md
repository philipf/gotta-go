# ADR-0016: File header comments

- **Status:** Accepted
- **Date:** 2026-06-13
- **Deciders:** Philip Fourie

## Context

Worker source files carried multi-line block comments at the top that restated design rationale, cited cross-file paths, and quoted ADR sections. This added noise without adding information: the rationale lives in the architecture guide and ADRs; the structure is visible in the code itself. Stale path citations and outdated design prose are a maintenance liability.

## Decision

A file header comment must be **one or two lines** and cover exactly two things:

1. **What** the file is — its role in the system, in plain terms.
2. **Why** the design is this way — only when that reason is non-obvious from reading the code.

If there is no non-obvious why, write one line. Stop there.

### What a header must not contain

- Design rationale that belongs in the architecture guide or an ADR.
- Cross-file path citations (fragile; renames silently invalidate them).
- ADR or section references mid-sentence (`(ADR-0005 §DI)` style).
- Editorial flourish ("the sin this prevents…").
- Restatements of what the code's own identifiers already say.

### Examples

```typescript
// Good — one line, states the role, stops.
// Composition root: wires each LayoutKey to its FramePreparer binder and owns FrameDeps,
// the one place that legitimately sees every feature's dependencies.

// Bad — ten lines, mixes rationale, path citations, and ADR references into prose.
// Composition root for the feature tier (architecture guide). Maps each layout key to
// a FramePreparer binder (framePreparers), and exports LayoutKey as the source
// of truth used by config/config-types.ts so phase config and the registry can never
// drift. Each binder receives the per-request FrameDeps bundle the orchestrator
// assembles once (ADR-0005 §DI) … [eight more lines]
```

## Consequences

- Headers read in two seconds or less.
- Rationale stays in the architecture guide and ADRs where it is maintained, not duplicated in source.
- Renames and restructures do not silently invalidate prose that lives next to the code.
