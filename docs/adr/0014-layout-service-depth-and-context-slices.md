# ADR-0014: Layout services own derivation; viewmodels are data contracts; layouts declare context slices

- **Status:** Superseded by [ADR-0017](0017-feature-services.md) — the two-phase
  layout service and per-feature context slices gave way to the one-capability
  prepare-dispatch model. The principles this ADR introduced survive there:
  derivation owns its own file, and viewmodels stay data contracts.
- **Date:** 2026-06-07
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related contracts:** [ADR-0005](0005-worker-source-architecture.md) (layout, DI, testing posture — partially amended here), [ADR-0007](0007-worker-architectural-pillars.md) (Deep Modules), #72 (two-phase layouts)

## Context

Two structural drifts had accumulated in the `features/<layout>/` tier, both
invisible until the dual_month_calendar review (this branch's pilot):

1. **Pass-through services, fat viewmodels.** Every `service.ts` — the file
   the registry names as owning phase 1 ("owns any external fetch and its
   error mapping and returns the format-agnostic view model") — delegated that
   work to a `buildViewModel` function in `viewmodel.ts`, which mixed the DTO
   type definitions with all derivation logic (142 lines for
   dual_month_calendar, 222 for priority_split). That is the pass-through
   anti-pattern ADR-0007 §1 names, and it left two functions called
   `buildViewModel` with different signatures in every feature folder.

2. **`RenderContext` as a union type; `env` as ambient authority.**
   `RenderContext` is the union of every layout's needs, so each layout's
   true dependencies were invisible from its signature:
   `stopPredictionLimit` (transit-only) was threaded to all four layouts, and
   the full `Env` gave every feature reach into every other feature's
   bindings and secrets. Reasoning about "what can this layout touch?"
   required reading every body; test fixtures faked the full context with
   `as unknown as Env` casts, and one (`api/router.test.ts`) silently missed
   the `PUBLIC_HOLIDAYS` binding — only a swallowed soft-miss warning noticed.

A stale testing rule kept the first drift in place: ADR-0005 directs feature
unit tests "one layer below" the public surface because the render pipeline is
wasm-blocked in the workers-pool sandbox. Since the two-phase split (#72),
that constraint applies only to phase 2 — `buildViewModel(ctx)` contains no
wasm and is fully testable at the public surface.

## Decision

### 1. `service.ts` owns the derivation; `viewmodel.ts` is the data contract

- **`service.ts` is the layout**: it implements the registry's `Layout`
  contract and contains (or composes) every derivation — external fetches,
  error mapping, and the pure maths that fill the view model. It is the deep
  module: `layout` is the narrow surface; the implementation hides behind it.
- **`viewmodel.ts` is logic-free**: the DTO types Satori receives plus their
  JSON projection (`toJsonView`). It answers exactly one question — *what
  shape does this layout draw?* — in a ten-second read.
- `toJsonView` stays in `viewmodel.ts` beside the types it projects. Where
  the projection is the identity (dual_month_calendar, minimal_clock), write
  `{ ...vm }` so a new field can never silently miss the diagnostics view.
  Where it is a real projection (idle_jokes drops render-only `fontSize`;
  priority_split maps to snake_case wire names), it stays explicit — the
  identity is the degenerate case, not the rule.
- One altitude per file: `service.ts` thinks, `viewmodel.ts` declares shape,
  `view.tsx` draws.

### 2. Feature tests drive the public `layout.buildViewModel(ctx)`

This **amends ADR-0005's testing exception**: "one layer below" applied to the
whole feature when `render()` bundled the wasm pipeline; after #72 it applies
to phase 2 only. Phase 1 tests go through the public surface with stubbed
bindings/fetch; the raster path remains verified via `wrangler dev` + curl.

**Escape hatch (use deliberately, not as a loophole):** when reaching a
behaviour through the public surface would violate a *stronger* rule, export
one explicitly-named, domain-granularity seam from `service.ts` and document
why. The canonical case is `priority_split`'s `viewModelFromStopStates`:
column/marker behaviour is specified against gateway `StopState`s because
driving those cases through `layout.buildViewModel` would put Metlink wire
payloads in the feature's tests — breaking the ADR-0005 wire-format
quarantine, which outranks single-entry purity. The fetch + error-mapping
path still tests the public surface.

### 3. Layouts declare the `RenderContext` slice they consume

The registry's `Layout` type gains a context parameter:

```ts
export type Layout<VM = unknown, Ctx = RenderContext> = {
	buildViewModel(ctx: Ctx): Promise<VM>;
	render(vm: VM, ctx: Ctx): Promise<RenderResult>;
	// …
};
```

Each layout declares the slice it actually consumes — its **dependency
manifest** — narrowing nested objects too:

```ts
// dual_month_calendar/service.ts
export type CalendarContext = Pick<RenderContext, 'timezone' | 'now' | 'format' | 'includeBmp'> & {
	radiator: Pick<Radiator, 'slug'>;
	env: Pick<Env, 'PUBLIC_HOLIDAYS'>;
};
```

The orchestrator is unchanged: it builds one full `RenderContext` per request
(ADR-0005 §DI), and a function accepting fewer fields than offered is sound
contravariance; method-syntax bivariance keeps concrete entries assignable to
the orchestrator-facing `Layout<unknown>`.

What this buys:

- **The signature answers "what can this feature touch?"** Widening a slice
  is a visible, reviewable diff; reaching another feature's binding cannot
  happen silently.
- **Test fixtures shrink to the declared needs.** The full-profile radiator
  fixtures and `as unknown as Env` casts disappear; `priority_split`'s
  `METLINK_API_KEY` is typed directly.

Current slices: `ClockContext` (no bindings, no fetch), `JokesContext`
(`fetchFn` + format only — no radiator), `PrioritySplitContext` (phase, fetch,
prediction limit, `METLINK_API_KEY`), `CalendarContext` (slug, clock,
`PUBLIC_HOLIDAYS`).

### Named, deferred end-state: capabilities at the composition root

The principled fix for ambient `env` is for features to never see bindings at
all: the orchestrator injects gateway closures (`fetchHolidays: () =>
Promise<Set<string>>`, `fetchArrivals(stop)` with key and limit bound), `Env`
collapses back into the entry point, and `stopPredictionLimit` migrates into
gateway-bound config where it belongs. **We are not doing this yet** —
per ADR-0005's "defaults stay light until they hurt", the machinery (per-
request wiring, a deps type per layout) isn't justified at four layouts and
one maintainer. The declared slices are the stepping stone: they are exactly
the dependency inventory that wiring would consume. Revisit when secrets
multiply or a wrong-binding incident actually occurs.

## Consequences

### Positive

- The registry contract's phase-1 sentence is now literally true of every
  `service.ts`; documentation and code agree.
- Three files, three questions per feature: shape (`viewmodel.ts`),
  derivation (`service.ts`), pixels (`view.tsx`).
- Dependency manifests make cross-feature reach a type error and shrink test
  fixtures to what the layout consumes.
- Phase-1 tests survive internal restructuring (they did not survive this
  refactor's predecessor shape — that was the tell).

### Negative / trade-offs

- Complexity is conserved, not reduced: `priority_split/service.ts` is now
  ~250 lines. The answer to a growing service is private functions, not a
  fourth file.
- Layout authoring gains one concept (the Ctx slice declaration).
- Slices are structural discipline, not enforcement — a layout *can* widen
  its own slice; the protection is that doing so is a reviewable diff.

## References

- [ADR-0005](0005-worker-source-architecture.md) — testing exception amended by §2; DI and wire quarantine unchanged
- [ADR-0007](0007-worker-architectural-pillars.md) — Deep Modules; the pass-through anti-pattern this retires from the layout tier
- [ADR-0011](0011-error-contract-problem-details.md) — error mapping that lives in the services
- `features/registry.ts` — the `Layout<VM, Ctx>` contract
- Branch `chore/refactor-readability` — pilot (dual_month_calendar) and rollout commits
