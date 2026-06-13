# ADR-0005: Worker source architecture — feature-folder layout with gateway tier

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — folder names must match canonical terms.
- **Related contracts:** [ADR-0003](0003-radiator-worker-contract.md) (radiator ↔ Worker), [ADR-0004](0004-diagnostics-view-content-negotiation.md) (Accept-based content negotiation).
- **Scope:** This ADR fixes *where code lives* — the repo shape, the tier map, and what each tier owns. *How to build* within that structure — the pillars, the gateway/feature/endpoint patterns, dependency injection, the wire quarantine, and the testing posture — lives in the canonical [Worker Architecture guide](../worker-architecture.md).

## Context

The PoC at `poc/worker/` proved the rendering pipeline (JSX → Satori SVG → resvg RGBA → 1-bit BMP → gzip) on Cloudflare Workers, but it is a single `fetch` handler with no auth, no config, no profile-phase resolution, and no routing structure. It is kept untouched as historical reference.

The production Worker has to grow in a predictable shape over the next several issues. The near-term roadmap already names the surface area:

- Multiple **layouts** (`minimal_clock`, `priority_split`, `idle`, …) each with their own view-model and renderer.
- Multiple **renderers per layout** (BMP for the radiator, JSON and SVG for diagnostics per ADR-0004).
- Multiple **upstream systems** (Metlink today; potentially weather and quotes services for the `idle` profile later).
- Profile-phase scheduling, slug-based config resolution, and shared HTTP/auth shell.

We need a directory layout that lets each of those concerns land in a foreseeable place — adding a layout means adding a folder, adding an upstream means adding a gateway — without structural rework or argument every time. This ADR fixes the layout, the naming rules, and the testing posture once, so subsequent implementation issues can spend their budget on behaviour rather than on bikeshedding directories.

## Decision

### Top-level repo shape

```
gotta-go/
├── .gitignore              # repo-wide ignores
├── src/
│   ├── worker/             # Cloudflare Worker source (this ADR)
│   │   ├── package.json    # Worker deps and devDeps
│   │   ├── wrangler.jsonc  # main: "index.ts" (relative to this folder)
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── mise.toml       # node + pnpm pin
│   │   └── …               # source tiers (see below)
│   └── radiator/           # ESP32 firmware (deferred until firmware work begins)
├── docs/
└── poc/                    # untouched historical reference
```

Each project under `src/` owns its own toolchain. The Worker keeps `package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, and `mise.toml` colocated with the source they configure — `cd src/worker && pnpm test` / `pnpm dev` works without root-level glue. Firmware will bring its own toolchain (PlatformIO / ESP-IDF) under `src/radiator/` when that work begins; the two siblings under `src/` are kept symmetric so neither becomes the implicit centre of gravity and neither's toolchain leaks into the other's space.

### Worker tier layout

Each tier folder's public-API file is named after what it does (no `index.ts`); the only `index.ts` in the tree is the top-level Worker entry that `wrangler.jsonc` points at. The naming rule keeps editor tabs informative ("validate.ts", "frame-registry.ts") instead of a wall of identical "index.ts".

```
src/worker/
├── index.ts                # fetch handler — delegates to api/router (wrangler main)
│
├── api/                    # HTTP edge: routing, negotiation, response shaping
│   ├── router.ts
│   ├── <endpoint>.ts       # one orchestrator per route (e.g. frame.ts)
│   ├── format.ts           # Accept header → response format
│   ├── response.ts         # response/header builders per ADR-0003
│   └── errors.ts           # error response builders
│
├── features/               # vertical slices — one folder per layout, plus the registry
│   ├── frame-registry.ts   # composition root: `framePreparers` + `LayoutKey`
│   └── <layout_name>/      # folder == glossary canonical term
│       └── …               # internal file roles per the Worker Architecture guide
│
├── auth/
│   └── validate.ts         # domain helper: token validation
├── config/
│   ├── lookup.ts           # domain helper: slug → profile lookup
│   ├── types.ts
│   └── data.ts
├── schedule/
│   └── resolve.ts          # domain helper: profile + now → phase/layout/sleep
│
├── gateways/               # one folder per external system — internal structure per the guide
│   └── <system_name>/      # e.g. metlink/, public_holidays/
│
├── shared/                 # format-agnostic infrastructure (flat — one file per concern)
│   ├── satori.ts           # JSX → SVG → RGBA
│   ├── bmp.ts              # RGBA → 1-bit BMP
│   └── gzip.ts             # CompressionStream wrapper
│
└── assets/                 # fonts, wasm, ambient type declarations
```

### Tier responsibilities — why each one exists separately

| Tier        | Owns                                                                                  | Knows about         |
|-------------|---------------------------------------------------------------------------------------|---------------------|
| `api/`      | HTTP edge: routing, `Accept` negotiation, status codes, response headers from ADR-0003 | `Request`/`Response`, `Headers` |
| `features/` | One vertical slice per **layout**: view-model construction + every renderer variant   | Domain types only — never `Request` |
| `auth/`, `config/`, `schedule/` | **Domain helpers** — pure logic the orchestrator composes        | Domain types and primitives |
| `gateways/` | One folder per external system — internal structure per the [guide](../worker-architecture.md) | The wire format of that one system |
| `shared/`   | Format-agnostic infrastructure usable by any feature                                  | Bytes, SVG, RGBA — no domain |
| `assets/`   | Binary / non-TS files (fonts, wasm) + ambient module declarations                     | — |

The split between `auth/`/`config/`/`schedule/` and `shared/` is deliberate: the former carry **domain** meaning (radiator identity, profile resolution, schedule semantics), the latter is pure infrastructure that would be equally at home in another product. Putting auth under `shared/` would hide its domain role.

### Feature folders are the unit of growth

- **One folder per layout.** Adding a layout is adding a folder; no other directory needs to change.
- **Folder name = glossary canonical term.** `minimal_clock`, `priority_split`, `idle_jokes` — never synonyms. The folder name is the same string the config key uses and the same string the schedule resolver returns as the layout key. One name, one place.
- **Each folder exposes one public capability**, and its internal file roles (contract / impl / view-model / view / tests, plus earned files) are defined in the [Worker Architecture guide](../worker-architecture.md).
- **Layouts are discovered via the registry.** `features/frame-registry.ts` is the composition root: it declares `framePreparers` and derives `LayoutKey` as the source of truth. `config/config-types.ts` type-only imports `LayoutKey` from there, so adding a layout means registering it once; the type follows automatically.
- **Tests live next to the code they describe** (`<layout>.test.ts` in the same folder). The PoC's separate `test/` tree is not carried over.

### Gateways — one folder per external system

Every external dependency lives in its own gateway folder, presenting a domain-shaped public contract; callers never see the wire format. This keeps wire-format quirks (Metlink field ordering, timestamp formats, partial response shapes — see the [Metlink reference](../reference/metlink-stop-predictions.md)) quarantined: the rest of the Worker depends on the contract, and the gateway is the bulkhead.

The internal structure of a gateway — contract/implementation split, file roles, naming — is defined in the [Worker Architecture guide](../worker-architecture.md).

**Clock is a gateway candidate, not a default.** Use inline `new Date()` and pass it as a parameter where needed. Promote to `gateways/clock/` the first time a test demands a fixed clock — YAGNI applies, but the slot is reserved.

### Defaults stay light until they hurt

| Concern            | Default                          | Promote when                                                |
|--------------------|----------------------------------|-------------------------------------------------------------|
| Router             | Raw `Request` / `Response`       | Route surface grows past ~3 endpoints — then introduce Hono or similar. |
| Config storage     | TypeScript object in `config/data.ts` | Schema stabilises and non-engineers need to edit it — migrate to YAML/KV. |
| Clock              | Inline `new Date()` passed as arg | A test needs a fixed clock — promote to `gateways/clock/`.   |
| Caching            | None                             | An upstream call is hot — add a cache inside that gateway ([ADR-0010](0010-no-metlink-cache-layer.md) records the first evaluation). |

Each of these is reversible; defer until the cost of the default is concrete, then move.

## Testing posture

Dependency injection at the edge, the wire-format quarantine, the /tdd rhythm,
the sandbox-blocked raster pipeline, and the "mock only at the boundary" rule are
all part of *how to build* — they live in the
[Worker Architecture guide](../worker-architecture.md). This ADR only fixes that
tests live next to the code they exercise, in the same folder.

## Consequences

### Positive

- **Predictable place for new work.** Every new issue maps to a tier: new layout → `features/`, new upstream → `gateways/`, new route → `api/`, new domain rule → `auth|config|schedule|…/`.
- **Glossary is enforced by structure.** Folder names == canonical terms; synonyms become syntactically impossible.
- **Wire-format quirks are quarantined.** Gateway mappers are the only place upstream payload shapes appear; the rest of the code reads domain types.
- **Tests scale with the code.** Co-located tests stay discoverable; integration-style tests through public interfaces survive refactors.
- **Diagnostic renderers (ADR-0004) drop in naturally.** A feature renders the negotiated format from one prepared view; `api/format.ts` already returns the right key.

### Negative / follow-ups

- **More folders than a single-file Worker.** Justified by the planned surface area (multiple layouts, multiple renderers, multiple upstreams). For a one-route Worker it would be overkill.
- **Each `src/<project>/` owns its own toolchain.** When `src/radiator/` arrives it will have its own `package.json` / build config alongside the Worker's — symmetric siblings under `src/`, no shared root-level toolchain to negotiate.
- **Migration from TypeScript config to YAML/KV is a future cost.** Acceptable while the schema is still moving.

## References

- [ADR-0001](0001-frame-transport-compression.md) — `Content-Encoding: gzip` on the frame body
- [Metlink reference](../reference/metlink-stop-predictions.md) — the upstream wire-format knowledge mappers quarantine
- [ADR-0003](0003-radiator-worker-contract.md) — endpoint shape and response headers that `api/` implements
- [ADR-0004](0004-diagnostics-view-content-negotiation.md) — how `Accept` selects which renderer in `features/<layout>/` runs
- [Worker Architecture guide](../worker-architecture.md) — *how to build* within this structure: the pillars, the gateway/feature/endpoint patterns, dependency injection, the wire quarantine, and the testing posture
- [`../glossary.md`](../glossary.md) — canonical term list that folder names must match
