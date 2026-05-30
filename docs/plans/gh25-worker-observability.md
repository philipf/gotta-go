# GH #25 — Enable Cloudflare Workers observability

> Status: ✅ implemented (uncommitted). Branch `feat/25-worker-observability` off `main`.
> Scope: `src/worker/` only — `wrangler.jsonc`, new `shared/log.ts`, instrument
> `api/frame.ts`. Pure server plumbing; no new deps; pnpm.
> Baseline before changes: **18 test files / 107 tests passing**.

## Why

The worker runs auth, config resolution, and rendering with no production
visibility into errors or performance. CF's native observability is free-tier
and needs minimal code. See issue #25.

## Agreed design (settled via /grill-me)

1. **Traces** — add `traces: { enabled: true }` to the existing
   `observability` block in `wrangler.jsonc` (the issue says `.toml`; this repo
   uses `.jsonc`). Keep `enabled: true`.

2. **`shared/log.ts`** — dependency-free structured logger.
   - `log.info / log.warn / log.error(event: string, fields?: Record<string, unknown>)`
   - Emits `console[method](JSON.stringify({ level, event, ...fields }))`.
   - **Level → matching console method** (`info`→`console.log`, `warn`→
     `console.warn`, `error`→`console.error`) so CF's dashboard Level facet works
     *and* the `level` field stays queryable. (Minor, deliberate deviation from
     the brief's literal "all via console.log".)
   - No timestamp field — CF stamps each event.

3. **Instrument `renderFrame()`** in `api/frame.ts` — the shared core that both
   `handleFrame` (production) and `handleTestFrame` (test- diagnostics, #21) flow
   through. Instrument here (covers both paths); **no source tag**.
   - Up front: `start = Date.now()`; read `hardwareId` (`X-Radiator-Hardware-Id`,
     the MAC, already sent by firmware) and optional `requestId` (`X-Request-Id`,
     included only when present).
   - Wrap auth → lookup → phase → render → response shaping in `try/catch`.
   - **Auth fail** → `log.warn('frame.unauthorized', { hardwareId, slug })`, then
     existing `unauthorized()` 401 (unchanged).
   - **Unknown slug** → `log.warn('frame.unknown_radiator', { hardwareId, slug })`,
     then existing `unknownRadiator()` 404 (unchanged).
   - **Success** → `log.info('frame.completed', { hardwareId, requestId?, slug,
     layoutKey, profilePhase, format, durationMs })`.
   - **Throw** → `log.error('frame.error', { hardwareId, requestId?, slug,
     durationMs, error: { name, message, stack } })`, guarded for non-`Error`
     throws, then **re-throw**. Existing behaviour preserved — an uncaught throw
     still becomes CF's 500. Response-shaping/back-off is **#47's** job
     (firmware-side), explicitly out of scope here.

4. **Correlation** — `hardwareId` always (when header present); `requestId` only
   when `X-Request-Id` present; otherwise rely on CF's native per-invocation
   grouping. No GUID generation in the worker. (`cf-ray` is CF-minted and can't be
   client-seeded; a future per-wake id would be firmware-sent `${mac}-${wakeCount}`
   via `X-Request-Id`.)

## Event taxonomy (dashboard query vocabulary)

| event                   | level | when                          |
|-------------------------|-------|-------------------------------|
| `frame.completed`       | info  | response shaped successfully  |
| `frame.unauthorized`    | warn  | shared-token validation fails |
| `frame.unknown_radiator`| warn  | slug resolves to nothing      |
| `frame.error`           | error | critical path throws          |

## Out of scope

- Response-shaping / sleep-on-error / stale indicator → **#47** (firmware-side).
- OTLP export, OpenTelemetry SDK (paid plan).
- New tests — keep existing suite green only (per brief). Verify the added
  `console` output trips no assertion.

## Checklist

- [x] Branch `feat/25-worker-observability` off `main`
- [x] Capture baseline test count (18 files / 107 tests)
- [x] Step 1 — `wrangler.jsonc`: add `traces: { enabled: true }`
- [x] Step 2 — add `shared/log.ts` (level→console method, JSON shape)
- [x] Step 3 — instrument `renderFrame()` in `api/frame.ts`
      - [x] read `hardwareId` / optional `requestId`, `start = Date.now()`
      - [x] `frame.unauthorized` warn on auth fail
      - [x] `frame.unknown_radiator` warn on unknown slug
      - [x] `frame.completed` info on success (durationMs, layoutKey, …)
      - [x] try/catch → `frame.error` + re-throw (guard non-Error)
- [x] Verify — `pnpm tsc --noEmit` clean
- [x] Verify — `pnpm vitest run` still 18 files / 107 tests passing
- [x] Verify — `console` output trips no test assertion

## Verification (must pass)

```bash
cd src/worker
pnpm tsc --noEmit          # expect: clean
pnpm vitest run            # expect: 18 files / 107 tests passing
```
