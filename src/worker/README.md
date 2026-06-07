# Worker

Cloudflare Worker source for GottaGo. Architecture: [ADR-0005](../../docs/adr/0005-worker-source-architecture.md).

## Prerequisites

- [mise](https://mise.jdx.dev/) installs the pinned `node` and `pnpm` versions from [`mise.toml`](./mise.toml):
  ```bash
  mise install
  ```

## Install

All commands run from `src/worker/` (this folder owns its own toolchain — see ADR-0005).

```bash
cd src/worker
pnpm install
```

## Run tests

Vitest runs against the Cloudflare workers-pool sandbox configured in [`vitest.config.ts`](./vitest.config.ts).

```bash
pnpm test           # watch mode
pnpm test --run     # single run, exits 0/1
```

Test discovery is scoped to `**/*.test.ts` and `**/*.test.tsx` colocated with the code they exercise. Per ADR-0005, drive a module through its public `index.ts` rather than reaching into internal files.

### What runs where

| Layer | Runner | Covers |
|---|---|---|
| Unit / behaviour | `pnpm test` (vitest workers-pool) | Pure-JS logic: domain helpers, view-models, BMP encoder, response shapers, gateway mappers. |
| Integration | `pnpm dev` (wrangler) + curl | Full HTTP pipeline including Satori → resvg → BMP → gzip. The workers-pool sandbox blocks `WebAssembly.instantiate` for yoga-wasm, so rendering is exercised only against a live Worker. |

## Run locally

```bash
echo "RADIATOR_SHARED_TOKEN=test-token-123" > .dev.vars
pnpm dev
# Worker listens on http://localhost:8787
```

### Test scenario slugs

For one-click visual smoke, request `X-Radiator-Slug: test-<phaseKey>`. The
Worker resolves a synthetic radiator carrying exactly that profile phase,
widened to all-day, and renders it — so you get a named phase's frame without
knowing the schedule or computing a timestamp. Unlike a production slug (whose
frame depends on wall-clock time, via `resolveProfilePhase`), a `test-` slug is
decoupled from the clock and never breaks when schedule windows are re-tuned.

`<phaseKey>` is any phase `key` configured in `config/data.ts`. The convention
auto-extends: every phase anyone adds is instantly testable as `test-<itsKey>`,
nothing to register. With today's seed data:

| Slug | Renders | Network |
|---|---|---|
| `test-morning_commute` | philip's two-target (bus + train) `priority_split` | live Metlink |
| `test-morning_school_run` | daughter's one-target `priority_split` | live Metlink |
| `test-daytime_calendar` | `dual_month_calendar` | offline |
| `test-afternoon_idle` | the idle `minimal_clock` phase | offline |

These resolve in **every environment** by design — there is no env gate, and no
security concern in serving them. An unknown phase key 404s, fail-closed like an
unknown radiator. The complementary [`X-Debug-Now`](#dev-time-override) header
takes the other half: it drives *real* phase selection at a chosen time.

```bash
curl -H "X-Radiator-Token: test-token-123" -H "X-Radiator-Slug: test-daytime_calendar" \
     -H "Accept: image/svg+xml" --compressed http://localhost:8787/v1/frame -o frame.svg
```

### Dev time override

`X-Debug-Now: <ISO timestamp>` pins server time so phase selection for a *real*
slug is deterministic. It only takes effect when `DEV_TIME_OVERRIDE=true` (set in
`.dev.vars` for `wrangler dev`) and is ignored in production. See
[`dev-time.ts`](./dev-time.ts).

### Caveat: gzip negotiation under `wrangler dev`

`wrangler dev` / miniflare normalises every inbound request's
`Accept-Encoding` to `"br, gzip"` to emulate the Cloudflare edge — even
when the curl client sends `Accept-Encoding: identity` or omits the
header entirely. This means the `gzip: false` branch of `api/response.frameOk`
is unreachable through `wrangler dev`; the shaper's no-`Content-Encoding`
behaviour is pinned at the unit-test layer instead. End-to-end verification
of an uncompressed BMP response is a production-only check.
