# ADR-0017: Feature services

- **Status:** Draft — written ahead of the `idle_jokes` pilot; to be refined
  from pilot-review findings, then Accepted
- **Date:** 2026-06-13
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related:** The feature-tier counterpart of
  [ADR-0016](0016-gateways.md) (contract/impl split, REPR, inverted pyramid);
  builds on [ADR-0005](0005-worker-source-architecture.md) (tiers, DI, wire
  quarantine), [ADR-0007](0007-worker-architectural-pillars.md) (Deep Modules,
  REPR), [ADR-0011](0011-error-contract-problem-details.md) (error contract),
  and [ADR-0013](0013-conditional-frame-requests.md) (conditional frames).
  Supersedes [ADR-0014](0014-layout-service-depth-and-context-slices.md) once
  Accepted.

## Context

A **feature** is the unit of display content: one folder under `features/`
per layout key (`idle_jokes`, `minimal_clock`, …), producing the frame for a
profile phase. Per frame request the API tier needs three things at different
moments: the JSON view (the diagnostics body and an ETag input), the
appearance version (the other ETag input), and — only when the conditional
check misses — the rendered artefacts. Rasterisation is the expensive step the
304 path must never pay for (ADR-0013), so the structure must let the
orchestrator answer "did the content change?" before any pixel work.

Features are also the unit of **isolation**: a human or an AI agent should be
able to grok one feature without reading the rest of the application, and
deleting a feature should mean deleting its folder. That puts features in
tension with shared types — any type a feature imports from the tiers above it
is reach the folder cannot sever.

This ADR records the standard structure of a feature. `features/idle_jokes/`
is the minimal reference implementation; `features/priority_split/` is the
non-trivial one (a parameterised gateway capability, a separate domain service,
multiple targets, and a test seam).

## Decision

A feature is a **Feature Folder** exposing **one REPR capability** — *prepare
the frame, with rendering deferred* — wired by the **registry acting as
composition root**. The sections below run highest overview first (ADR-0016
§7).

### 1. The Feature Folder is the unit of ownership

Everything the feature is — its contract, derivation, error policy, data
shapes, and pixels — lives in `features/<key>/`. The folder's permitted
imports point only *sideways or down*:

- **gateway contract files** (`gateways/<system>/<capability>.ts`) — types and
  capabilities, never a gateway's internals;
- **`config/`** — the resolved domain/config types the feature derives from
  (`TransitTarget`, `Radiator`): the composition root passes the values, the
  feature names their types;
- **`shared/`** — cross-cutting mechanisms only (the `AppError` hierarchy,
  encoders, formatting helpers).

A feature never imports from `api/`, from the registry, or from another
feature. Deleting a feature is deleting its folder plus a small, *named*
residue: its wiring entry in the registry, its line in the `ProblemSlug`
union (§4), and its entries in the docs. Anything else left behind is a
structure bug.

### 2. One capability: prepare the frame, render deferred

The feature's entire public surface is one function — the canonical Deep
Module (ADR-0007 §1):

```ts
prepareJokeFrame(req: PrepareJokeFrameRequest): Promise<PrepareJokeFrameResponse>

type PrepareJokeFrameResponse = {
	view: Record<string, unknown>;        // JSON projection — diagnostics body + ETag input
	version: number;                      // appearance revision (LAYOUT_VERSION) — ETag input
	render: () => Promise<JokeRenderResult>; // deferred artefacts; closes over the
	                                      // private view model and the requested flags
};
```

The response is everything cheap, plus a **deferred `render` closure** for
everything expensive. The orchestrator computes the ETag from `view` +
`version`, and on a validator hit returns 304 without `render` ever running.
The view model — the structured input the renderer receives — is **fully
private**: it exists only inside the closure. No opaque tokens cross the
surface, and no caller can see or depend on the feature's internal shapes.

### 3. The request injects capabilities, not transport or context

The request type is the feature's **dependency manifest**. It carries:

- **Bound gateway capabilities.** The feature declares the bound shape it
  needs, importing the gateway's *response* type (and any domain type its
  parameters name). The shape may be nullary or take a domain argument:

  ```ts
  export type JokeSource = () => Promise<FetchJokeResponse>;
  export type ArrivalsSource = (target: TransitTarget) => Promise<FetchArrivalsResponse>;
  ```

  The composition root binds transport (`fetch`, env bindings, config) when
  wiring; an `ArrivalsSource` binder closes over `fetch` + the API key + the
  prediction limit and maps the `TransitTarget` to the gateway request. The
  feature never sees `fetch`, `Env`, or an upstream wire format — the ADR-0005
  wire quarantine extends to the feature's *tests*, which stub domain-typed
  results instead of HTTP responses.

- **Plain values it derives from**, named in the feature's own vocabulary:
  artefact flags (`includeBmp`, `includeSvg`), a clock (`now`), a timezone, the
  transit targets to render — whatever this feature's derivation consumes, and
  nothing more. Response format negotiation is an API-tier concern; by the time
  a request reaches a feature it has collapsed into flags.

There is no shared context object. Each feature's request is its own REPR
type; widening it is a reviewable diff at the feature *and* at the wiring
site.

### 4. Failure is a thrown `AppError`; the policy lives in the feature

Gateways report outcomes as data (`ok: false` unions — ADR-0016 §3); the
feature is where outcome becomes **policy**. `errors.ts` owns the feature's
problem-type factories and the gateway-error → `AppError` mapping; `prepare`
(or its `render` closure) throws, and the API failure boundary turns the
throw into problem+json (ADR-0011, unchanged). The response type stays
success-shaped.

The `ProblemSlug` union in `shared/errors.ts` remains **closed**: it is the
typed mirror of the documented error catalog (`docs/api/errors.md`), so a
typo'd or undocumented slug cannot compile. The feature's slug line in that
union is part of its named deletion residue (§1).

### 5. Files are named by role

These six are the **minimum** every feature has (`features/idle_jokes/`, the
minimal reference):

```
features/idle_jokes/
	prepare-joke-frame.ts       contract — REPR types + capability + re-export
	prepare-joke-frame-impl.ts  impl — fetch → map → derive → compose render
	errors.ts                   policy — problem factories + gateway-error mapping
	viewmodel.ts                data contract — the private VM types + projections
	view.tsx                    pixels — the renderer + LAYOUT_VERSION
	idle_jokes.test.ts          tests — drive the public capability
```

A non-trivial feature **earns more files** by the ADR-0016 §6 rule (role or
substance, not line count). `features/priority_split/` (the non-trivial
reference) adds two:

```
	domain-service.ts           substantial derivation — the gateway-StopStates →
	                            view-model maths, plus the domain-granularity test seam
	mode-icon.tsx               a sub-view component of view.tsx
```

- **`<capability>.ts` is the contract** — named by the capability, exactly as
  in the gateway tier, so the import path *is* the capability:
  implementation-free, ordered inverted-pyramid (capability → request →
  response → payload types), with the impl re-exported under the clean public
  name — the same mechanics as ADR-0016 §5, including the type-erased
  `contract → impl` edge.
- **The export is the bare verb-named function** (`prepareJokeFrame`), not a
  service object. The function type *is* the contract; a one-method object is
  ceremony.
- **The impl is a thin orchestrator** — fetch → map → compose. Trivial
  derivation lives inline (idle_jokes builds its view model in three lines);
  substantial derivation graduates into `domain-service.ts`, which also houses
  any domain-granularity test seam (priority_split's `viewModelFromStopStates`,
  specified against gateway types so the wire format never enters the feature's
  tests — ADR-0005).
- `viewmodel.ts` and `view.tsx` are internal composed files — nothing outside
  the folder imports them. `viewmodel.ts` holds the private VM types and their
  **projections** — `toJsonView` (the JSON envelope) and any display-label
  projection (priority_split's `serviceName`), kept here rather than in
  `view.tsx` so they stay unit-testable off the sandbox-blocked Satori path.
  Pure pixel-sizing derivation (idle_jokes' font bucketing) lives in `view.tsx`.

### 6. The registry is the composition root and owns the caller-side types

`features/registry.ts` declares what *it* requires of every feature:

```ts
export type PreparedFrame = {
	view: Record<string, unknown>;
	version: number;
	render: () => Promise<RenderResult>;
};
export type FramePreparer = (deps: FrameDeps) => Promise<PreparedFrame>;

export const layouts = {
	idle_jokes: (deps) => prepareJokeFrame({ /* bind gateways, collapse format */ }),
	…
} satisfies Record<string, FramePreparer>;
```

Each entry is a **binder**: it receives the per-request `FrameDeps` bundle the
orchestrator assembles once (ADR-0005 §DI) and builds the feature's own
request — binding gateway capabilities to transport and collapsing format
negotiation into flags. Features declare their response types **in full** and
import nothing from the registry; compatibility is *structural*, proven by the
`satisfies` check exactly at the wiring site. Drift between a feature and the
caller's requirement is a compile error in the registry — the file you would
edit to fix it.

`FrameDeps` is the union of every feature's needs, and that is acceptable
*here and only here*: the composition root is the one place that legitimately
sees everything. The sin this structure prevents is a feature importing it.

### 7. ETag derivation stays in the API tier

`api/etag.ts` owns both halves of the conditional-request mechanism: validator
generation (`weakEtag(view, version)`) and validation
(`ifNoneMatchSatisfied`). Features expose the *inputs* (`view`, `version`);
the hash algorithm and the HTTP semantics stay central, so every feature is
hashed identically by construction and generation can never drift from
validation.

## Consequences

### Positive

- "Open the contract, see the whole interface" holds for features as it does
  for gateways: one file, one function, REPR types, no plumbing.
- The view model is unobservable from outside — the orchestrator handles no
  opaque tokens and calls no projection methods.
- The request type is a real dependency manifest: tests stub domain-typed
  capabilities, never wire JSON; reaching another feature's binding is
  impossible rather than merely visible.
- Deleting a feature is deleting its folder plus a named, bounded residue.
- The `satisfies` check makes feature↔caller drift a compile error at the
  wiring site.

### Negative / trade-offs

- Small structural types (the artefact envelope) are spelled out per feature
  instead of imported — deliberate duplication, traded for severed coupling.
- The composition root must know each feature's dependencies; adding a feature
  means writing its binder. (This is the dependency inventory made explicit,
  not new coupling.)
- A one-line `ProblemSlug` residue per feature remains in `shared/` — accepted
  as the price of a compiler-checked error catalog.

## Open questions for the pilot review

- ~~Are `includeBmp`/`includeSvg` the right request vocabulary?~~ **Resolved:**
  flat flags read cleanly in both the idle_jokes and priority_split binders; not
  nested.
- Does `FrameDeps` earn a leaner shape once the remaining two features migrate
  off the transitional `fromLayout` adapter and the context slices disappear?
- `shared/` guardrails: this ADR shrinks `shared/` (error policy moves out) but
  defines neither the admission rule **nor who may import a feature**. The
  metlink migration left `api/api.test.ts` importing the feature's `metlink-*`
  factories as problem-shaping fixtures — a test reaching down into a feature.
  §1 governs a feature's *outbound* imports, not its inbound ones. Likely its
  own short ADR after the rollout.

## References

- [ADR-0016](0016-gateways.md) — the gateway-tier counterpart; §5 mechanics
  reused verbatim
- [ADR-0005](0005-worker-source-architecture.md) — tiers, DI, wire-format
  quarantine
- [ADR-0007](0007-worker-architectural-pillars.md) — Deep Modules, REPR
- [ADR-0011](0011-error-contract-problem-details.md) — the thrown-`AppError`
  boundary
- [ADR-0013](0013-conditional-frame-requests.md) — the 304 skip the deferred
  `render` exists to serve
- [ADR-0014](0014-layout-service-depth-and-context-slices.md) — superseded by
  this ADR once Accepted
- `features/idle_jokes/` — the minimal reference implementation
- `features/priority_split/` — the non-trivial reference (parameterised gateway
  capability, separate domain service, test seam)
