# Worker Architecture — Operational Guide

How to reason about Worker code without re-reading the whole tree. Decisions live in ADRs; this is the **running language** for talking about them and the **heuristics** that have emerged from applying them.

When this guide and an ADR appear to conflict, the ADR wins — flag the conflict and propose an update.

## Pillars

These three terms are the shared vocabulary for every architectural conversation in `src/worker/`. They are defined and justified in [ADR-0007](../adr/0007-worker-architectural-pillars.md).

1. **Deep Modules** — small public surface, substantial hidden implementation. Pass-through modules are an anti-pattern.
2. **Feature Folders** — one folder per layout in `features/<layout>/`. Vertical slicing is the unit of growth. Cross-feature imports are forbidden except through `features/registry.ts`.
3. **REPR** — one file per HTTP endpoint in `api/<endpoint>.ts`. Narrow request/response shapers; one orchestrator per file.

## Heuristics (When → Then)

These triggers replace static rules. Apply when the **when** clause becomes true; ignore until then.

| When | Then | Why |
|---|---|---|
| A 2nd feature needs a helper that currently lives inside a single feature folder | Lift the helper to `shared/` as part of that 2nd feature's change | Speculative sharing is the #1 cause of horizontal drift (ADR-0007) |
| `api/router.ts`'s `if`-ladder reaches 3+ endpoints | Replace with a `{ method, path, handler }` table — or adopt Hono per ADR-0005 | Convention becomes self-enforcing instead of relying on reviewer vigilance |
| `features/registry.ts` reaches 4+ entries and becomes a merge-conflict hotspot | Replace central registration with discovery (each feature exports a layout descriptor) | Centralisation cost rises super-linearly with N |
| A module's public file approaches ~80 lines or its imports balloon | Split the **internals**, not the public surface | Depth > breadth (Deep Modules) |
| `api/format.ts` is still a 1-line stub after #19/#20 land | Inline into the renderer | A pass-through that never grew its real job is dead weight |
| A wire-format field name appears outside `gateways/<system>/` | Stop; that's the bulkhead leaking | ADR-0005 §Gateways — mappers are the only file that knows the wire |
| A test wants a fixed clock | Promote `gateways/clock/` then; not before | ADR-0005 — defaults stay light until they hurt |
| A new external system is introduced | New folder under `gateways/` with the standard layout (client, mapper, types, fixtures, public face) | ADR-0005 §Gateways |
| A feature test can only reach a behaviour through `layout.buildViewModel` by feeding wire payloads to a stubbed fetch | Export one explicitly-named, domain-granularity seam from `service.ts` and document why (e.g. `priority_split`'s `viewModelFromStopStates`) | The wire-format quarantine outranks single-entry purity (ADR-0014) |

Add a row when a new trigger emerges; never add a row for a trigger that hasn't fired yet.

## Conventions (with reasoning)

The *reasoning* is the load-bearing part — when an edge case arises, judge it against the reason, not the rule.

- **Module-named public file, not `index.ts` barrels.** `metlink.ts`, `validate.ts`, `lookup.ts`, `service.ts`. The only `index.ts` in the tree is the Worker entry. *Why:* informative editor tabs; avoids cold-start risk from barrel-induced eager wasm evaluation. See [ADR-0007 §Module-named public file](../adr/0007-worker-architectural-pillars.md#module-named-public-file-not-indexts-barrels).
- **DI at the edge.** `src/worker/index.ts` is the only file that constructs `new Date()` or reads Cloudflare bindings. Everything downstream receives those as arguments. *Why:* every helper testable in isolation with primitive inputs (ADR-0005).
- **Gateways are the only wire→domain mappers.** `mapper.ts` inside the gateway folder is the single bulkhead. *Why:* upstream quirks (Metlink field ordering, partial responses, timestamp formats) stay quarantined.
- **Type-only cross-tier imports are allowed when they prevent invalid states.** `config/types.ts` imports `LayoutKey` from `features/registry.ts`. *Why:* config can never reference a layout that isn't implemented. The dependency is type-only and one-directional.
- **Failure variants stay narrow at the type layer.** `validate()` returns `{ ok: true } | { ok: false }` — no `reason` field. *Why:* the OpenAPI contract deliberately collapses missing-vs-invalid; the type makes the leak structurally impossible (`auth/validate.ts`).
- **Use the glossary's vocabulary** in code symbols, folder names, commit messages, ADRs, and prose. The rejected-synonym list in [`../glossary.md`](../glossary.md) is a contract.
- **`service.ts` thinks, `viewmodel.ts` declares shape, `view.tsx` draws.** The service is the deep module owning every derivation (fetch, error mapping, pure maths); the viewmodel is a logic-free data contract (DTO types + `toJsonView`). *Why:* one altitude per file — the registry's phase-1 sentence is literally true of the file that claims it; the output shape is a ten-second read. See [ADR-0014](../adr/0014-layout-service-depth-and-context-slices.md).
- **Layouts declare their `RenderContext` slice.** Each `service.ts` exports a `<Layout>Context` (`Pick` of `RenderContext`, narrowing `radiator`/`env` too) used as the registry's `Ctx` parameter. *Why:* the signature is the dependency manifest — widening it is a reviewable diff, cross-feature binding reach can't happen silently, and test fixtures shrink to the declared needs. Stepping stone to composition-root capability injection (named, deferred — ADR-0014).
- **Response shapers carry a `*Response` suffix.** A function that constructs an HTTP response *we return to our caller* is suffixed `…Response` (`problemResponse`, `failureResponse`, `frameBmpResponse`, `frameSvgResponse`, `frameJsonResponse`, `frameNotModifiedResponse`, `notFoundResponse`). *Why:* in a REPR tree (ADR-0007) the shaper is a named role; the suffix announces the terminal wire-shaping step at the callsite and disambiguates from same-stem domain concepts (`frameOk` read like a predicate). **Scope:** the terminal per-variant leaf shapers only — orchestrators keep their verb (`shapeFrame` negotiates then delegates), private composition helpers keep their job-name (`frameBody`), and gateway `fetch*` functions are excluded because their `Response` is the *upstream* one, not ours. The content variants are named by *format* (`frameBmp`/`frameSvg`/`frameJson`, keyed like `shapeFrame`'s switch), not status — 200 is the unmarked default; the one non-200, `frameNotModified`, names itself.
- **`lookup<X>(key)` vs `resolve<X>(inputs)`.** `lookup` = key → record (static config/registry access; could be a `Map.get()`). `resolve` = inputs → derived value via rules (time, content negotiation, profile phases). *Why:* the verb encodes the operation. `lookupRadiator(slug)` and `resolveProfilePhase(radiator, now)` carry different mental models at the callsite; collapsing to one verb hides whether rules are running.

## Anti-patterns we've rejected

- **`index.ts` barrels re-exporting wasm-bearing modules.** Cold-start risk on Workers (`shared/satori.ts` lazy-init exists *because* module-eval cost matters).
- **Premature tier promotion.** Lifting code into a new horizontal tier before a second consumer exists. The original `shared/mode-icon.tsx` placement was this anti-pattern; it now lives in `features/priority_split/`.
- **Pass-through orchestrators.** A function whose body is a single dispatch into a sibling earns no depth. Either grow it or inline it. (Concrete rejection: every layout `service.ts` had this shape until ADR-0014 merged the derivation in — commit `e0767c4` and follow-ups.)
- **Reaching past a module's public face.** `import { internalThing } from '../module/internal'` from another module. Convention today; lint enforcement parked for later.
- **Bulk-writing tests ahead of implementation.** ADR-0005 mandates the `/tdd` rhythm: one RED → one GREEN → optional REFACTOR → next slice.

## What this guide deliberately does NOT contain

When you need these, go to the source — not this doc — so it doesn't grow stale.

- **The current directory tree** → `ls src/worker/`.
- **The current feature list** → `src/worker/features/registry.ts` (`LayoutKey` is derived from it).
- **The current endpoint list** → `src/worker/api/router.ts`.
- **The wire contract** → [ADR-0003](../adr/0003-radiator-worker-contract.md) + `docs/api/openapi.yaml`.
- **Test framework configuration** → `src/worker/vitest.config.ts`.
- **Tier responsibilities + the layout decision** → [ADR-0005](../adr/0005-worker-source-architecture.md).
- **The decision behind the pillars** → [ADR-0007](../adr/0007-worker-architectural-pillars.md).

If you find this guide describing something that belongs in one of the sources above, delete the description and point at the source.

## Pointers

- [ADR-0001](../adr/0001-frame-transport-compression.md) — gzip on the frame body
- [ADR-0002](../adr/0002-metlink-stop-predictions-field-mapping.md) — wire-format mapping rules
- [ADR-0003](../adr/0003-radiator-worker-contract.md) — radiator ↔ Worker contract
- [ADR-0004](../adr/0004-diagnostics-view-content-negotiation.md) — `Accept`-based content negotiation
- [ADR-0005](../adr/0005-worker-source-architecture.md) — directory layout, gateway tier, DI, TDD
- [ADR-0007](../adr/0007-worker-architectural-pillars.md) — Deep Modules, Feature Folders, REPR
- [ADR-0014](../adr/0014-layout-service-depth-and-context-slices.md) — layout service depth, viewmodel data contracts, declared context slices
- [`../glossary.md`](../glossary.md) — ubiquitous language
- [`./domain.md`](domain.md) — how to consume the domain docs

## Maintaining this guide

- Add a heuristic row **only after** the trigger has fired at least once.
- Add an anti-pattern **only after** rejecting it concretely (cite the commit or ADR).
- Remove anything that has migrated into an ADR.
- If a section grows past ~30 lines, ask whether the content really belongs here or in an ADR.
