# ADR-0005: Worker source architecture — feature-folder layout with gateway tier

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — folder names must match canonical terms.
- **Related contracts:** [ADR-0003](0003-radiator-worker-contract.md) (radiator ↔ Worker), [ADR-0004](0004-diagnostics-view-content-negotiation.md) (Accept-based content negotiation).

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

Each tier folder's public-API file is named after what it does (no `index.ts`); the only `index.ts` in the tree is the top-level Worker entry that `wrangler.jsonc` points at. The naming rule keeps editor tabs informative ("validate.ts", "registry.ts") instead of a wall of identical "index.ts".

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
│   ├── registry.ts         # `layouts` const + `LayoutKey = keyof typeof layouts`
│   └── <layout_name>/      # folder == glossary canonical term
│       ├── service.ts      # public API: single async `render(profile, now, format)`
│       ├── viewmodel.ts
│       ├── bmp.tsx         # renderer per Accept variant
│       ├── json.ts         # added when diagnostics land
│       ├── svg.tsx
│       └── <layout_name>.test.ts
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
├── gateways/               # Fowler gateway pattern — one folder per external system
│   └── <system_name>/      # e.g. metlink/, quotes/, weather/, clock/
│       ├── <system>.ts     # public interface — domain-shaped types only
│       ├── client.ts       # HTTP / runtime call
│       ├── mapper.ts       # wire format → domain (the only place that knows the wire)
│       ├── cache.ts        # KV / in-flight cache policy
│       ├── types.ts
│       ├── fixtures.ts
│       └── *.test.ts
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
| `gateways/` | One folder per external system: client, wire→domain mapper, cache, fixtures           | The wire format of that one system |
| `shared/`   | Format-agnostic infrastructure usable by any feature                                  | Bytes, SVG, RGBA — no domain |
| `assets/`   | Binary / non-TS files (fonts, wasm) + ambient module declarations                     | — |

The split between `auth/`/`config/`/`schedule/` and `shared/` is deliberate: the former carry **domain** meaning (radiator identity, profile resolution, schedule semantics), the latter is pure infrastructure that would be equally at home in another product. Putting auth under `shared/` would hide its domain role.

### Feature folders are the unit of growth

- **One folder per layout.** Adding a layout is adding a folder; no other directory needs to change.
- **Folder name = glossary canonical term.** `minimal_clock`, `priority_split`, `idle` — never synonyms. The folder name is the same string the `config.yaml` key uses, the same string the schedule resolver returns as `layoutKey`. One name, one place.
- **Each folder exposes one public function: `render`.**
  ```ts
  // features/<layout>/service.ts
  export async function render(
    profile: Profile,
    now: Date,
    format: ResponseFormat,
  ): Promise<Uint8Array>;
  ```
  Internally the file holds a `Record<ResponseFormat, (vm: ViewModel) => Promise<Uint8Array>>` map keyed on the `ResponseFormat` union, so adding a new format to the union surfaces a TypeScript error in every feature until a renderer is supplied. `viewmodel.ts` stays an internal collaborator — it isn't part of the public surface.
- **Layouts are discovered via the registry.** `features/registry.ts` declares `layouts` (a `Record<LayoutKey, render>`) and derives `LayoutKey = keyof typeof layouts`. `config/types.ts` type-only imports `LayoutKey` from there, so adding a layout means registering it once; the type follows automatically.
- **Tests live next to the code they describe** (`<layout>.test.ts` in the same folder). Because the BMP pipeline (Satori → resvg → BMP) is blocked inside the workers-pool sandbox (see the testing section), feature unit tests go one layer below the public `render()` and import collaborators (e.g. `./viewmodel`) directly; the full pipeline is exercised end-to-end via `wrangler dev` + curl. The PoC's separate `test/` tree is not carried over.

### Gateways — Fowler's pattern, one folder per external system

Every external dependency lives in its own gateway folder. The folder owns:

- The HTTP / runtime call (`client.ts`).
- The wire-format → domain mapping (`mapper.ts`) — **the only file in the codebase that knows what the upstream's payload looks like**.
- Cache policy (`cache.ts`) — KV reads/writes, TTLs, in-flight coalescing.
- Test fixtures (`fixtures.ts`) — recorded payloads for replay.
- The public interface (`<system>.ts`, named after the gateway) — domain-shaped types only; callers never see the wire format.

This keeps wire-format quirks (Metlink field ordering, timestamp formats, partial response shapes per ADR-0002) quarantined. The rest of the Worker depends on the domain interface; the mapper is the bulkhead.

**Clock is a gateway candidate, not a default.** Use inline `new Date()` and pass it as a parameter where needed. Promote to `gateways/clock/` the first time a test demands a fixed clock — YAGNI applies, but the slot is reserved.

### Deep modules, dependency injection, pure returns

Every public function takes everything it needs as arguments and returns a value:

- No globals, no module-level singletons, no `process.env` reads inside helpers, no internal `new Date()`.
- `Date`, `Headers`, environment secrets, KV bindings — all passed in by `index.ts` or the orchestrator.
- Helpers return data (`{ ok: true } | { ok: false, response: Response }`); the orchestrator decides what to do with it.

The HTTP entry point is the only place that touches Cloudflare's runtime types and the only place that constructs `new Date()`. Everything downstream is testable in isolation with primitive inputs.

### Defaults stay light until they hurt

| Concern            | Default                          | Promote when                                                |
|--------------------|----------------------------------|-------------------------------------------------------------|
| Router             | Raw `Request` / `Response`       | Route surface grows past ~3 endpoints — then introduce Hono or similar. |
| Config storage     | TypeScript object in `config/data.ts` | Schema stabilises and non-engineers need to edit it — migrate to YAML/KV. |
| Clock              | Inline `new Date()` passed as arg | A test needs a fixed clock — promote to `gateways/clock/`.   |
| Caching            | None                             | An upstream call is hot — add `cache.ts` in that gateway.    |

Each of these is reversible; defer until the cost of the default is concrete, then move.

## Testing approach

Use the **/tdd skill** for all Worker code: tracer-bullet vertical slices, **one RED test → one GREEN minimal impl → optional REFACTOR → next slice**. Never bulk-write tests.

| Layer          | Runs in                          | Covers                                                                                                            |
|----------------|----------------------------------|-------------------------------------------------------------------------------------------------------------------|
| **Unit / behaviour** | Vitest (workers-pool sandbox)    | Pure-JS logic: domain helpers, view-model builders, BMP encoder, response/error shapers, gateway mappers.   |
| **Integration**      | `wrangler dev` + curl            | Full HTTP pipeline including Satori → resvg → BMP → gzip. The PoC discovered that yoga-wasm's `WebAssembly.instantiate` is blocked inside the workers-pool sandbox, so the rendering pipeline can only be exercised end-to-end in a live Worker runtime. |
| **Visual smoke**     | Eyes on rendered output          | Once per layout / per significant render change.                                                              |

**Mocks only at system boundaries.** Tests substitute exactly four things:

- `Headers` — constructed via `new Headers({...})`.
- `env` values — passed as plain strings/objects, not via runtime bindings.
- `Date` — passed as a parameter, not constructed inside helpers.
- Gateway public interfaces — when a feature test wants deterministic upstream data, it stubs the gateway's `index.ts` export, not the HTTP client below it.

Cloudflare runtime APIs (`CompressionStream`, `Response`, the `fetch` export shape) are used directly and verified in the integration layer; they are not mocked.

Tests are **integration-style through public interfaces** wherever the runtime allows it: prefer driving a feature folder via its `service.ts` `render()` over reaching into `viewmodel.ts` or `bmp.tsx`. The exception is the BMP pipeline itself (Satori + resvg + yoga-wasm), which is sandbox-blocked — feature unit tests there import the next layer down (`./viewmodel`) and the full pipeline is verified live via `wrangler dev` + curl.

## Consequences

### Positive

- **Predictable place for new work.** Every new issue maps to a tier: new layout → `features/`, new upstream → `gateways/`, new route → `api/`, new domain rule → `auth|config|schedule|…/`.
- **Glossary is enforced by structure.** Folder names == canonical terms; synonyms become syntactically impossible.
- **Wire-format quirks are quarantined.** Gateway mappers are the only place upstream payload shapes appear; the rest of the code reads domain types.
- **Tests scale with the code.** Co-located tests stay discoverable; integration-style tests through public interfaces survive refactors.
- **Diagnostic renderers (ADR-0004) drop in naturally.** A feature folder gains `json.ts` and `svg.tsx` next to `bmp.tsx`; `api/format.ts` already returns the right key.

### Negative / follow-ups

- **More folders than a single-file Worker.** Justified by the planned surface area (multiple layouts, multiple renderers, multiple upstreams). For a one-route Worker it would be overkill.
- **The empty `gateways/` tier looks unused at first.** Reserved deliberately so the first gateway lands in the established place rather than triggering a layout debate.
- **Each `src/<project>/` owns its own toolchain.** When `src/radiator/` arrives it will have its own `package.json` / build config alongside the Worker's — symmetric siblings under `src/`, no shared root-level toolchain to negotiate.
- **Migration from TypeScript config to YAML/KV is a future cost.** Acceptable while the schema is still moving.

## Verification

When an implementation issue lands a new piece of Worker code, the following should hold:

1. Each layout occupies exactly one folder under `features/`, named with its glossary canonical term, and is registered in `features/registry.ts`. `LayoutKey` is derived as `keyof typeof layouts` and is the only `LayoutKey` in the codebase.
2. No file outside `gateways/<system>/mapper.ts` references that upstream's wire-format field names.
3. No file outside the top-level `index.ts` constructs `new Date()` or reads from Cloudflare bindings directly; downstream code receives everything as arguments.
4. Tests live next to the code they exercise; the only directories matching `**/test/**` are inside gateway `fixtures.ts` neighbourhoods.
5. `pnpm test` (run from `src/worker/`) runs vitest against the workers-pool sandbox and exits 0.
6. The HTTP pipeline (Satori + resvg + gzip) is verified at least once via `wrangler dev` (run from `src/worker/`) + curl per implementation issue.

## References

- [ADR-0001](0001-frame-transport-compression.md) — `Content-Encoding: gzip` on the frame body
- [ADR-0002](0002-metlink-stop-predictions-field-mapping.md) — why upstream mappers carry the wire-format knowledge
- [ADR-0003](0003-radiator-worker-contract.md) — endpoint shape and response headers that `api/` implements
- [ADR-0004](0004-diagnostics-view-content-negotiation.md) — how `Accept` selects which renderer in `features/<layout>/` runs
- [`../glossary.md`](../glossary.md) — canonical term list that folder names must match
- `/tdd` skill — the testing rhythm this ADR mandates for Worker code
- Martin Fowler, *Patterns of Enterprise Application Architecture* — Gateway pattern
