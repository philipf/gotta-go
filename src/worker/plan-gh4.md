# Worker tracer: issue #4 minimal_clock frame via /v1/frame

## Context

Issue #4 (the "tracer" slice) is the first real implementation of the radiator ↔ Worker contract defined in [ADR-0003](../../docs/adr/0003-radiator-worker-contract.md) and [`docs/api/openapi.yaml`](../../docs/api/openapi.yaml). The user is waiting on a LilyGO panel before firmware work (#1 blocker), but issue #4's body now splits cleanly: **Worker ACs are curl-testable today; firmware ACs stay blocked on #1.** This plan covers the Worker ACs only.

The existing PoC at `poc/worker/` proves the rendering pipeline (JSX → Satori SVG → resvg RGBA → 1-bit BMP → gzip) on Cloudflare Workers in production. It has zero auth, config, profile-phase resolution, or routing structure — it's a single `fetch` handler that always renders the same hardcoded `priority_split` test pattern. The PoC stays as historical reference; we don't evolve it.

This plan creates a fresh production Worker at `src/worker/` following the layout and conventions in [ADR-0005](../../docs/adr/0005-worker-source-architecture.md). The ADR fixes the directory shape, naming rules, gateway tier, deep-module/DI posture, and testing approach (TDD via the `/tdd` skill). This plan is the **#4-specific instantiation** of that architecture: which folders #4 actually creates, what to port from the PoC, and the slice-by-slice walk that delivers the Worker ACs.

## Scope for #4

Concretely, #4 creates the following Worker tiers — each named per ADR-0005 — and leaves the rest reserved-but-empty:

| ADR-0005 tier | What #4 creates                                        | What #4 leaves empty                             |
|---|---|---|
| `api/`          | `router.ts`, `frame.ts`, `negotiate.ts`, `response.ts`, `errors.ts` | — |
| `features/`     | `minimal_clock/` with `index.ts`, `phase.ts`, `viewmodel.ts`, `bmp.tsx`, `minimal_clock.test.ts` | `json.ts` and `svg.tsx` (added by #19 / #20)     |
| `auth/`         | `index.ts`, `auth.test.ts`                             | — |
| `config/`       | `index.ts`, `data.ts`, `types.ts`, `config.test.ts`    | YAML/KV migration (deferred)                     |
| `schedule/`     | nothing — phase resolution lives inside `features/minimal_clock/phase.ts` while only one feature exists | The whole tier — promote to `schedule/` once a second feature forces the shared seam (#5). |
| `gateways/`     | nothing — `minimal_clock` has no upstream              | `metlink/` (#5+), `quotes/` (#17), `clock/` (when a test needs it) |
| `shared/`       | `satori/`, `bmp/`, `gzip/` ported from the PoC         | — |
| `assets/`       | `PressStart2P-Regular.ttf`, `assets.d.ts` copied from PoC | — |

ADR-0005 reserves a `schedule/` tier for "profile + now → phase / layout / sleep", but its own "Defaults stay light until they hurt" rule tells us not to populate that tier yet. While `minimal_clock` is the only feature in tree, the resolver is one tiny function with one caller, so it sits inside `features/minimal_clock/phase.ts`. When `priority_split` lands in #5 and a second feature needs the same lookup, lift `phase.ts` up to `schedule/` then — that promotion is the YAGNI exit gate, not the default.

`api/negotiate.ts` for #4 returns `'bmp'` unconditionally — content negotiation per [ADR-0004](../../docs/adr/0004-diagnostics-view-content-negotiation.md) lights up when #19/#20 add the JSON/SVG renderers.

## Request flow for #4

```
GET /v1/frame
  X-Radiator-Slug: bedroom-philip-tania
  X-Radiator-Token: <secret>
  Accept-Encoding: gzip
  Accept: image/bmp                    ← #4 only handles image/bmp
        │
        ▼
src/worker/index.ts             → forwards to api/router.ts
        │
        ▼
api/router.ts                   → matches GET /v1/frame → api/frame.ts
        │
        ▼
api/frame.ts:
  1. auth.validate(headers, sharedToken)     → 401 (X-Sleep-Seconds: 3600) if token missing/invalid
  2. config.lookupRadiator(slug)             → 404 (X-Sleep-Seconds: 3600) if unknown slug
  3. pick layout                             → #4 only has 'minimal_clock'; api/frame dispatches directly
  4. feature.resolvePhase(profile, now)      → { phase, sleepSeconds }   (inside features/minimal_clock/)
  5. feature.buildViewModel(profile, now)    → { time, date, slug }
  6. api/negotiate.ts                        → Accept: image/bmp → feature.renderers.bmp
  7. feature.renderers.bmp(viewmodel)        → Uint8Array (64,862-byte BMP)
  8. shared/gzip.gzip(bmp)                   → compressed bytes
  9. api/response.ts                         → Response with all headers from ADR-0003
        │
        ▼
200 OK
  Content-Type: image/bmp
  Content-Encoding: gzip
  X-Sleep-Seconds: <n> in [30, 14400]
  X-Server-Time: <ISO 8601 UTC>
  X-Profile-Phase: <phase key | idle_profile>
  <gzipped 1-bit BMP body>
```

## Public interfaces for #4

Per ADR-0005 (deep modules, DI, pure returns): each helper takes everything it needs as arguments and returns a value — no globals, no internal `new Date()`, no `process.env`.

```ts
// auth/index.ts
export type AuthResult = { ok: true } | { ok: false };
export function validate(headers: Headers, sharedToken: string): AuthResult;
// Note: the failure branch carries no Response so api/errors stays the sole
// owner of HTTP shaping. Missing vs invalid token are deliberately collapsed
// into a single { ok: false } variant per ADR-0003 (indistinguishable 401).

// config/index.ts
export type Profile = { slug: string; timezone: string; phases: Phase[] };
export function lookupRadiator(slug: string): Profile | undefined;

// features/minimal_clock/index.ts
export type ViewModel = { time: string; date: string; slug: string };
export type PhaseResolution = { phase: string; sleepSeconds: number };
export function resolvePhase(profile: Profile, now: Date): PhaseResolution;
export function buildViewModel(profile: Profile, now: Date): ViewModel;
export const renderers = { bmp: (vm: ViewModel) => Promise<Uint8Array> };
// Note: resolvePhase lives here (not under a top-level schedule/) until a
// second feature forces a shared seam — see "Scope for #4" above.
```

## What to port from the PoC

| Source (PoC) | Destination | Treatment |
|---|---|---|
| `poc/worker/src/bmp.ts` | `src/worker/shared/bmp/index.ts` | Verbatim port. Already pure-JS and standalone. |
| `poc/worker/src/render.ts` | `src/worker/shared/satori/index.ts` | Verbatim port, but import `pressStartTtf` from `../../assets/PressStart2P-Regular.ttf`. Keep the lazy-init pattern — it's the cold-start defence. |
| `poc/worker/src/PressStart2P-Regular.ttf` | `src/worker/assets/PressStart2P-Regular.ttf` | Copy. |
| `poc/worker/src/assets.d.ts` | `src/worker/assets/assets.d.ts` | Copy. |
| `poc/worker/src/layout.tsx` | **NOT ported** — that's the `priority_split` test pattern, deferred to #5/#6 | The new `features/minimal_clock/bmp.tsx` is a fresh JSX template (large `HH:MM`, small date below). |
| `poc/worker/wrangler.jsonc` | `src/worker/wrangler.jsonc` | Adapt: `main: "index.ts"` (relative to `src/worker/`), keep `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`, and the `rules` for `.ttf` bundling. |
| `poc/worker/package.json` | `src/worker/package.json` | Same deps (`satori`, `@resvg/resvg-wasm`), same devDeps (wrangler, vitest, etc.). |

## TDD slice order

Per ADR-0005 (testing approach) and the `/tdd` skill: tracer-bullet vertical slices, **one RED test → one GREEN minimal impl → optional REFACTOR → next slice**. Never bulk-write tests. Walk the rows top-to-bottom; do not skip ahead. Slice 0 (plumbing) is the only prerequisite; everything else is vertical.

| # | Slice | Test | Layer | Status |
|---|---|---|---|---|
| **0** | Repo plumbing: `package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`; copy TTF + `assets.d.ts`; `pnpm install` | — (no test; verified by `vitest --run` exiting 0 with no test files yet) | — | ✅ done (commit `95c6384`) |
| **1** | Port `shared/bmp` from PoC + its existing test | All-white RGBA encodes to a 64,862-byte BMP starting with `42 4d` | vitest | ✅ done |
| **2** | Port `shared/satori` from PoC verbatim (no test — sandbox blocks wasm; smoke-tested via slice 7) | — | — | ✅ done |
| **3** | `shared/gzip` | Round-trip: `gzip(bytes)` length < `bytes.length` for repetitive input | vitest | ✅ done |
| **4** | `config/data` + `config/lookupRadiator` | Tracer: `lookupRadiator('bedroom-philip-tania')` returns the seeded profile | vitest | ✅ done |
| **5** | `auth/validate` happy path | Matching token returns `{ ok: true }` | vitest | ✅ done |
| **6** | `features/minimal_clock/phase` (`resolvePhase`) happy path | All-day phase + any `now` returns `{ phase, sleepSeconds: <within [30,14400]> }` | vitest | ⬜ todo |
| **7** | `features/minimal_clock/viewmodel` (`buildViewModel`) happy path | Returns `{ time: matches /^\d{2}:\d{2}$/, date: matches /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/, slug }` | vitest | ⬜ todo |
| **8** | `api/errors` + `api/response` shapers | `unauthorized()` returns a `Response` with status 401, body "unauthorized", `X-Sleep-Seconds: 3600` | vitest | ⬜ todo |
| **9** | **Tracer bullet end-to-end**: wire `index.ts` → `api/router` → `api/frame` → all the above; deploy + curl | Happy-path curl returns 200, valid 64,862-byte BMP after gunzip, `X-Sleep-Seconds` present, `X-Server-Time` present, `X-Profile-Phase` present | `wrangler dev` curl | ⬜ todo |
| **10** | Missing token returns identical 401 to invalid token (no oracle) | Two curls (no token, wrong token); responses byte-identical except for `Date` header | vitest unit + curl | ⬜ todo |
| **11** | Unknown slug returns 404 with `X-Sleep-Seconds: 3600` and body "unknown radiator" | vitest unit + curl | ⬜ todo |
| **12** | Gzip negotiation: `Accept-Encoding: gzip` → `Content-Encoding: gzip` header + smaller body; absent → uncompressed BMP | curl | ⬜ todo |
| **13** | Visual smoke: open the returned `frame.bmp` in an image viewer — clock reads current `HH:MM`, date is today | eyes | ⬜ todo |

After all slices are green, look for refactor candidates per `/tdd` refactoring guidance (duplication, shallow modules, primitive obsession). **No refactoring while RED.**

### Behaviors deliberately NOT tested in #4

- **Phase edge cases** (DST, phase boundary, multi-day rollover, idle-profile fall-through) — the seeded config has one all-day phase, so they're unreachable. Land with #5; that's also when `resolvePhase` lifts out of `features/minimal_clock/` into a shared `schedule/` tier.
- **Multiple Accept renderers** — only `image/bmp` matters; `api/negotiate` returns `'bmp'` unconditionally. Property-test in #19/#20.
- **Cold-start retry semantics** — known PoC issue; the firmware client handles it per ADR-0003. Worker side has nothing to test.
- **Pixel-exact BMP correctness** — `shared/bmp` is byte-deterministic and inherited from a deployed PoC. Snapshot testing would just rehash the PoC's existing validation.

## Verification

All seven Worker ACs from issue #4 are curl-testable from a `wrangler dev` instance:

```bash
# Setup
cd <repo>/src/worker
echo "RADIATOR_SHARED_TOKEN=test-token-123" > .dev.vars
pnpm install
pnpm dlx wrangler dev
```

```bash
# AC1: token validation (both missing and invalid return identical 401)
curl -i -H "X-Radiator-Slug: bedroom-philip-tania" http://localhost:8787/v1/frame
# expect: 401, X-Sleep-Seconds: 3600, body "unauthorized"

curl -i -H "X-Radiator-Slug: bedroom-philip-tania" -H "X-Radiator-Token: wrong" http://localhost:8787/v1/frame
# expect: identical 401 response

# AC2: unknown slug
curl -i -H "X-Radiator-Slug: ghost" -H "X-Radiator-Token: test-token-123" http://localhost:8787/v1/frame
# expect: 404, X-Sleep-Seconds: 3600, body "unknown radiator"

# AC3+4+5+6: full happy path
curl -i -H "X-Radiator-Slug: bedroom-philip-tania" \
       -H "X-Radiator-Token: test-token-123" \
       -H "Accept-Encoding: gzip" \
       --compressed \
       --output frame.bmp \
       http://localhost:8787/v1/frame
# expect: 200, Content-Type: image/bmp, Content-Encoding: gzip,
#         X-Sleep-Seconds (30..14400), X-Server-Time (ISO 8601),
#         X-Profile-Phase set, body is a valid BMP

# AC4 (continued): verify BMP shape
stat -c %s frame.bmp     # expect 64862
xxd frame.bmp | head -1  # expect first two bytes "42 4d" (BM signature)
```

Plus the colocated unit tests:
```bash
pnpm test
# expect: auth/, config/, schedule/, minimal_clock/ tests all pass
```

## Out of scope (deferred to other issues)

- **Firmware ACs of issue #4** — blocked by #1.
- **JSON renderer for `minimal_clock`** — issue #19.
- **SVG renderer for `minimal_clock`** — issue #20.
- **`priority_split` feature** — issues #5, #6 (with Metlink, KV cache).
- **`idle` profile** — issue #17.
- **`gateways/metlink/` (Fowler gateway: client, mapper, cache, fixtures)** — issues #5+.
- **`gateways/quotes/` or similar for idle profile content** — issue #17.
- **`gateways/clock/` (RealClock / FixedClock)** — introduce only when a test needs a fixed clock.
- **Migration of config from TypeScript to YAML/KV** — defer until schema stabilises.
- **Multi-phase schedule logic** — for the tracer, one all-day phase is enough to verify the resolution code path; richer schedules land with #5, at which point `phase.ts` is promoted from `features/minimal_clock/` to a top-level `schedule/` tier (per ADR-0005's "Defaults stay light until they hurt").
- **Real production deploy + secret management** — issue #12 covers the multi-radiator rollout. **#4's Worker work ends at `wrangler dev` validation**; deploy lands when the firmware needs it.

## References

- [ADR-0003](../../docs/adr/0003-radiator-worker-contract.md) — radiator ↔ Worker contract (endpoint, headers, status codes, sleep-seconds range)
- [ADR-0004](../../docs/adr/0004-diagnostics-view-content-negotiation.md) — `Accept`-based content negotiation; #4 only handles `image/bmp`
- [ADR-0005](../../docs/adr/0005-worker-source-architecture.md) — directory layout, gateway tier, deep-modules + DI, TDD posture
- [`docs/api/openapi.yaml`](../../docs/api/openapi.yaml) — wire spec the Worker implements
- `/tdd` skill — testing rhythm for every slice
