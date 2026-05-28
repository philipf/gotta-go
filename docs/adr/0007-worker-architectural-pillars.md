# ADR-0007: Worker architectural pillars — Deep Modules, Feature Folders, REPR

- **Status:** Accepted
- **Date:** 2026-05-28
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related contracts:** [ADR-0005](0005-worker-source-architecture.md) (directory layout, gateway tier, DI, TDD)

## Context

[ADR-0005](0005-worker-source-architecture.md) fixes the Worker's directory layout and tier responsibilities. It does not, however, name the underlying design principles those choices serve. Without that vocabulary, follow-on decisions ("should this be a barrel?", "where does this new helper live?", "is this module too thin?") get re-argued from first principles every time.

This ADR names the three principles that ADR-0005's structure already embodies, so future decisions can be made and reviewed in that shared language. It also records two conventions that emerged after ADR-0005 was written.

## Decision

Adopt the following three pillars as the language for architectural discussion in the Worker codebase.

### 1. Deep Modules (Ousterhout)

Each module presents a **small, narrow public surface** behind which **substantial implementation** is hidden. The public surface is the cost paid by every caller; the hidden implementation is the benefit. The depth ratio (benefit ÷ cost) should be high.

- **Pass-through modules are an anti-pattern.** A module whose public function is a one-line dispatch into a sibling file is not earning its keep; either give it real work or inline it.
- **Information hiding is the goal.** Wire formats, wasm bootstrap, encoding schemes, status taxonomies — all hidden behind their module's public face.
- **Canonical example in this codebase:** `gateways/metlink/metlink.ts` — one `fetchArrivals(req): FetchResult` function hides HTTP, wire types, error mapping, and the wire→domain transformation.

### 2. Feature Folders (vertical slicing)

The codebase is organised by **cohesive business capability**, not by technical layer. The `features/<layout_name>/` tier is the unit of growth: a new layout is a new folder. Files that change together live together.

- **Cross-feature imports are forbidden** except through the registry (`features/registry.ts`).
- **Speculative shared code is the #1 cause of horizontal drift.** A helper used by exactly one feature lives inside that feature. Lift to `shared/` only when a *second* consumer earns the move.
- The horizontal tiers that remain (`api/`, `auth/`, `config/`, `schedule/`, `gateways/`, `shared/`) are the **infrastructure** the vertical slices stand on — not the unit of feature growth.

### 3. REPR (Request-Endpoint-Response, Steve Smith)

Every HTTP route has a **dedicated, self-contained handler module** with **narrow request/response shapers**. One file per endpoint; one orchestrator per file.

- **`api/<endpoint>.ts` is the rule**, not the exception. `api/frame.ts` handles `GET /v1/frame`; the next endpoint gets its own file.
- **Request shape is narrow.** Handlers receive a parsed/typed input, not raw `Request`. Today this is `(request, env, now)` with parsing inline; a typed request shape lands when a 2nd endpoint forces the seam.
- **Response shape is narrow.** Response and error shaping live in `api/response.ts` and `api/errors.ts`. Handlers compose; they do not construct `Response` directly.

### Conventions added by this ADR

These are not in ADR-0005 and are recorded here.

#### Module-named public file (not `index.ts` barrels)

Each module's public face is named after what it does (`metlink.ts`, `validate.ts`, `lookup.ts`, `resolve.ts`, `service.ts`), not `index.ts`. The only `index.ts` in the tree is the Worker entry point.

- **Reason 1 — Readability.** Import sites read `from '../gateways/metlink/metlink'` or `from '../gateways/metlink'` (with package resolution), both of which carry meaning. A wall of `index.ts` tabs in the editor carries none.
- **Reason 2 — Cold start.** `shared/satori.ts` has hand-tuned lazy wasm initialisation because module-evaluation cost matters on Workers. Barrel files re-exporting wasm-bearing modules risk pulling that evaluation into every caller's eager-load graph.
- **Enforcement is convention, not lint** (today). A boundary-enforcing ESLint rule is designed but parked; revisit when accidental cross-module imports start happening.

#### Speculative-shared rule

A helper considered "potentially shared" lives in its first consumer's feature folder until a second consumer exists. Promotion happens at the second use, not the first. Reverting the original move (`shared/mode-icon.tsx` → `features/priority_split/mode-icon.tsx`, commit `fc24ce5`) is the canonical example.

## Consequences

### Positive

- Future architectural decisions can be made in shared vocabulary, reducing re-litigation.
- New AI agents joining the project can read [ADR-0005](0005-worker-source-architecture.md) + this ADR + [`../agents/worker-architecture.md`](../agents/worker-architecture.md) and understand the driving forces without re-reading the tree.
- The "speculative-shared" rule formalises a default that prevents horizontal drift.

### Negative / follow-ups

- Adopting named patterns invites cargo-cult application. The pillars are tools, not laws; if a specific case argues against them, the specific case wins — flag it in a future ADR.
- The "module-named public file" convention diverges from the dominant TypeScript-ecosystem idiom (`index.ts` barrels). New contributors familiar with that idiom need to learn the local convention; the living guide documents why.

## References

- John Ousterhout, *A Philosophy of Software Design* — chapters on Deep Modules and Information Hiding.
- Jimmy Bogard, *Feature Folders* — vertical slice organisation.
- Steve Smith, *REPR Design Pattern* — Request-Endpoint-Response for HTTP APIs.
- [ADR-0005](0005-worker-source-architecture.md) — the directory layout these pillars describe.
- [`../agents/worker-architecture.md`](../agents/worker-architecture.md) — living operational guide; heuristics and anti-patterns that grow over time.
