# Plan: issue #5 — `priority_split` layout, single transit target (Tiers 1–3, track, marker)

> **Status:** not started. This plan delivers the *rendering* surface of `priority_split` for a profile phase with **one transit target**, ending in a live render of `daughter_school.morning_school_run` on a real radiator — the first end-user demo of transit data on GottaGo hardware.

## Context

Issue [#5](https://github.com/philipf/gotta-go/issues/5) was re-scoped after the #2 spike: the Metlink fetch (now [#23](https://github.com/philipf/gotta-go/issues/23), **closed**) was extracted. A KV cache was also extracted (#24) but has since been **dropped** — there is no caching layer ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)), so `fetchArrivals` calls Metlink directly. What remains is the `features/priority_split/` slice — view-model construction, Tier 1–3 rendering, and the track + marker — for the single-column case.

This slice sits on three things already in the tree:

- **The Metlink gateway (#23).** `gateways/metlink/metlink.ts` exposes `fetchArrivals(req)` returning domain-shaped `StopState` / `Arrival[]` — no Metlink field names leak. This slice consumes that interface and never re-touches wire parsing.
- **The mode icon (#33).** `features/priority_split/mode-icon.tsx` already exports `modeIcon({ mode, height })` (a Satori-ready `<img>`), plus `Mode`, `MODE_GRIDS`, `onCells`, `modeIconSvg`. This slice is its **first live render** — see the verification note below.
- **The #4 Worker baseline.** `api/` orchestration, `auth/`, `config/`, `schedule/`, `shared/{bmp,satori,gzip}`, and the `features/registry.ts` dispatch are all in place from the tracer.

Authoritative references for the maths and the language:
- **Glossary §3** (Leave In, Leave By, Arrives In, Next service), **§5** (track, marker, window), **§6** (time to stop, comfort buffer, leave margin) — `docs/glossary.md`.
- **PRD §5.1** (per-column layout), **§5.3** (marker position formula), **§5.4** (typography) — `docs/PRD/GottaGo PRD v0.4.md`.
- **ADR-0002** — Metlink field mapping + the `service_id` config-schema extension (string | string[]).
- **ADR-0005** — directory shape, deep modules + DI (env/KV/fetch passed in, never read from globals), co-located tests, the `wrangler dev` integration seam for the wasm-blocked raster path.

## Two scoping decisions taken before this plan

1. **Schedule resolver — time-window matching, idle deferred.** #4 deferred real multi-phase resolution to here. This slice implements start/end-time matching in the configured timezone so `morning_school_run` is actually selected during its window (07:15–08:30). A request that falls outside every configured window keeps a documented fallback (return the first phase) with a `TODO(#17)` — the real `idle_profile` layout + fall-through stays issue #17.
2. **Build against the uncached gateway.** #5 was nominally "blocked by #24", but #23's `fetchArrivals` is the *public* gateway entry and is already done. This slice calls it directly — and that is now the permanent shape: the gateway stays uncached ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)), so there is no wrapping layer to wait for and no cache tests to add.

## Scope for #5

| ADR-0005 tier | What #5 creates / changes | What #5 leaves alone |
|---|---|---|
| `features/priority_split/` | `viewmodel.ts`, `service.ts`, `bmp.tsx`, `priority_split.test.ts`; **reuses** existing `mode-icon.tsx` | `json.ts`, `svg.tsx` (diagnostics — #19/#20) |
| `features/registry.ts` | register `priority_split`; **migrate the render signature to a `RenderContext` object** (see *Threading env*) | — |
| `schedule/resolve.ts` | replace the `phases[0]` stopgap with time-window matching; return the matched `ProfilePhase` | idle fall-through layout (#17) |
| `config/types.ts` | add `TransitTarget` + `transitTargets?` on `ProfilePhase` | YAML/KV migration |
| `config/data.ts` | seed the `daughter_school` profile + `bedroom-daughter` radiator (real IDs from ADR-0002 / GH #16) | — |
| `api/frame.ts` | build the `RenderContext` (pass `env` + `fetch` + matched phase to the renderer) | — |
| `env.d.ts` / `.dev.vars` | declare + supply `METLINK_API_KEY` | — (no KV binding — ADR-0010) |
| `gateways/metlink/` | **untouched** — consumed only | client/mapper (no cache — ADR-0010) |

## Config schema extension

Add the transit-target shape to `config/types.ts` (mirrors PRD §9 + the ADR-0002 `service_id` extension). `Mode` is imported from the feature's `mode-icon.tsx` (its canonical home until a second transit feature forces a lift to `shared/`):

```ts
// config/types.ts
import type { Mode } from '../features/priority_split/mode-icon';

export type TransitTarget = {
  mode: Mode;                       // 'bus' | 'train' — drives the mode icon
  stopId: string;                   // numeric bus code or alphanumeric station code
  serviceId: string | string[];     // ADR-0002: single route or any-of array (["634","635"])
  timeToStopMins: number;           // glossary §6 — home→stop, any mode
  comfortBuffer: number;            // glossary §6 — multiplier sizing the marker window
};

export type ProfilePhase = {
  key: string;
  startTime: string;                // "HH:MM"
  endTime: string;                  // "HH:MM"
  layout: LayoutKey;
  refreshIntervalMinutes: number;
  transitTargets?: TransitTarget[]; // present for priority_split, absent for minimal_clock
};
```

Seed `config/data.ts` with the `daughter_school` profile (real validated IDs — stop `3234`, routes `["634","635"]`, `time_to_stop_mins: 5`, `comfort_buffer: 3`) and the `bedroom-daughter` radiator ref, exactly as PRD §9. The profile also carries the `afternoon_idle` `minimal_clock` phase so the resolver has a second window to match against.

## Schedule resolver — time-window matching

Replace the `phases[0]` stopgap. Convert `now` to wall-clock minutes-since-midnight in `GLOBAL.timezone` (via `Intl.DateTimeFormat` `hour`/`minute`, same pattern as `minimal_clock/viewmodel.ts`), then select the first phase whose `[startTime, endTime)` window contains it. `ProfilePhaseResolution` gains the matched `phase: ProfilePhase` so the orchestrator can hand its `transitTargets` to the renderer:

```ts
export type ProfilePhaseResolution = {
  profilePhase: string;   // phase.key (or 'idle_profile' once #17 lands)
  phase: ProfilePhase;    // NEW — the matched phase, carries transitTargets
  layout: LayoutKey;
  sleepSeconds: number;
};
```

- **No window matches** (overnight gap): fall back to the first phase and emit a `// TODO(#17): idle_profile fall-through`. Do **not** error — the Worker never 500s on "no active phase" (glossary §7, ADR-0003).
- **DST ambiguous/skipped hour** stays out of scope — comparison is on local wall-clock minutes, which is correct for ordinary days; the once-a-year ambiguous hour is a documented non-goal here.

## Threading env into renderers (`RenderContext`)

The current registry render signature is `(radiator, timezone, now, format)` — no `env`, no `fetch`, no phase. `priority_split` needs all three (Metlink API key, the injected `fetch`, and the active phase's `transitTargets`). Migrate the registry to a single context object — cleaner than growing a positional list, and it keeps DI explicit per ADR-0005 (the orchestrator owns all bindings):

```ts
// features/registry.ts
export type RenderContext = {
  radiator: Radiator;
  phase: ProfilePhase;
  timezone: string;
  now: Date;
  format: ResponseFormat;
  env: Env;            // METLINK_API_KEY, RADIATOR_SHARED_TOKEN, (KV binding later)
  fetchFn: typeof fetch;
};

export const layouts = {
  minimal_clock: minimalClockRender,
  priority_split: prioritySplitRender,
} satisfies Record<LayoutKey, (ctx: RenderContext) => Promise<Uint8Array>>;
```

`minimal_clock/service.ts` adapts to take `ctx` and ignores `env`/`phase`/`fetchFn` (regression-guarded by its existing tests). `api/frame.ts` builds the context from the values it already has plus `globalThis.fetch`:

```ts
const { profilePhase, phase, layout, sleepSeconds } = resolveProfilePhase(radiator, now);
const ctx = { radiator, phase, timezone: GLOBAL.timezone, now, format, env, fetchFn: fetch };
const rendered = await layouts[layout](ctx);
```

## Domain computations (the heart of the slice)

All pure, all in `priority_split/viewmodel.ts`, all driven by glossary symbols. Times use the **realtime/predicted** value from the gateway (`Arrival.predicted`, which already null-coalesces to scheduled per the mapper) so a delayed service shifts Leave In later and the marker left "for free" — even though the *delayed banner* itself is deferred.

```
leave_by_time   = arrival_time − time_to_stop_mins                 # glossary §3
leave_in_mins   = max(0, round((arrival_time − time_to_stop_mins − now) / 60s))
arrives_in_mins = max(0, round((arrival_time − now) / 60s))
leave_margin    = max(0, (leave_by_time − now) / 60s)              # glossary §6
window          = time_to_stop_mins × comfort_buffer              # glossary §5, PRD §5.3
position_ratio  = 1 − clamp(leave_margin / window, 0, 1)          # 0 = hard-left, 1 = NOW
```

**Catchable-service selection (AC2):** sort the gateway's (already `service_id`-filtered) arrivals ascending by `predicted`; the **catchable service** is the earliest one whose `leave_by_time ≥ now` (i.e. `leave_in ≥ 0` — not yet a *missed service*). The **next service** is the following arrival (Tier 3). The **route code** in the column header is taken from the *selected* arrival's `serviceId`, which makes the array form (`["634","635"]`) render whichever route is actually catchable.

**Rendering rules (glossary §3, PRD §5.1):**

| Field | Rule | Renders |
|---|---|---|
| Leave In (Tier 1 hero) | `leave_in_mins` | `7 MIN`, or literal `NOW` when `0` |
| Leave By (Tier 2 anchor) | `leave_by_time` in tz | `BY 07:08` (comfort buffer **excluded**) |
| Arrives (Tier 2 detail) | `arrives_in_mins` + `arrival_time` | `ARRIVES 4 MIN · 07:14` |
| Next (Tier 3) | next arrival's time, else none | `NEXT 07:22`, or `—` |
| Marker | `position_ratio` along the track | diamond at `ratio × track_width`; hard-right = Now |
| Global header | wall-clock in tz | `07:03`, centred full width |

### View-model shape

```ts
export type ColumnViewModel = {
  mode: Mode;            // → modeIcon()
  routeCode: string;     // selected arrival's serviceId, e.g. "634"
  leaveIn: string;       // "7 MIN" | "NOW"
  leaveBy: string;       // "BY 07:08"
  arrives: string;       // "ARRIVES 4 MIN · 07:14"
  next: string;          // "NEXT 07:22" | "—"
  markerRatio: number;   // 0..1
};
export type PrioritySplitViewModel = {
  wallClock: string;             // "07:03"
  columns: ColumnViewModel[];    // single element for one target; auto full-width
};
```

`service.ts` orchestrates the impure edge — fetch each target via the gateway, then call the pure `buildViewModel`:

```ts
export async function render(ctx: RenderContext): Promise<Uint8Array> {
  const targets = ctx.phase.transitTargets ?? [];
  const states = await Promise.all(targets.map((t) =>
    fetchArrivals({ fetch: ctx.fetchFn, apiKey: ctx.env.METLINK_API_KEY,
                    stopId: t.stopId, serviceId: t.serviceId })));
  const vm = buildViewModel(targets, states, ctx.timezone, ctx.now);
  return renderers[ctx.format](vm);
}
```

`buildViewModel(targets, states, tz, now)` is pure and unit-tested directly (bypassing the wasm-blocked raster path, per ADR-0005). A `FetchResult` error or `{ kind: 'closed' }` state degrades that column gracefully (dashes) without crashing; the full **no-service** literal, **delayed** banner, and **cancelled** strike-through are exception states deferred (see *Out of scope*).

## Request flow for #5 (priority_split branch)

```
GET /v1/frame  (X-Radiator-Slug: bedroom-daughter, valid token, Accept-Encoding: gzip)
  → api/frame: auth.validate → config.lookupRadiator('bedroom-daughter')
  → schedule.resolveProfilePhase(radiator, now)         → morning_school_run / priority_split (in window)
  → build RenderContext { radiator, phase, tz, now, format, env, fetchFn }
  → layouts['priority_split'](ctx):
        service.render → fetchArrivals(stop 3234, service ["634","635"])   ← gateway (#23), uncached
                       → buildViewModel(...)  → PrioritySplitViewModel
                       → renderers.bmp(vm)    → 64,862-byte 1-bit BMP
  → gzip → frameOk(...)  → 200 with ADR-0003 headers (X-Sleep-Seconds, X-Server-Time, X-Profile-Phase: morning_school_run)
```

## TDD slice order

Per ADR-0005 + the `/tdd` skill: one RED test → one GREEN minimal impl → optional REFACTOR. Walk top-to-bottom. Pure-logic slices are vitest; the raster + HTTP path is verified live via `wrangler dev` + curl (wasm is sandbox-blocked).

| # | Slice | Test | Layer |
|---|---|---|---|
| 0 | Config schema + seed: `TransitTarget`/`transitTargets` on `ProfilePhase`; seed `daughter_school` + `bedroom-daughter` | `lookupRadiator('bedroom-daughter')` returns a profile whose `morning_school_run` phase carries one `bus` transit target (stop `3234`, `["634","635"]`) | vitest |
| 1 | Schedule time-window matching + returned `phase` | `resolveProfilePhase(daughter, 07:30 NZ)` → `morning_school_run`/`priority_split`; `09:00 NZ` → `afternoon_idle`/`minimal_clock` | vitest |
| 2 | `RenderContext` refactor (registry + `frame.ts` + `minimal_clock` adapt) | existing `minimal_clock` tests stay green; `minimal_clock` render via `ctx` returns a BMP (regression slice — keep green, no behaviour change) | vitest |
| 3 | `viewmodel`: Leave In | `leaveIn` is `7 MIN`; clamps to `NOW` at 0 and never negative | vitest |
| 4 | `viewmodel`: Leave By | `BY 07:08`; comfort buffer **not** applied | vitest |
| 5 | `viewmodel`: Arrives In + arrival time | `ARRIVES 4 MIN · 07:14` | vitest |
| 6 | `viewmodel`: Next service / `—` | `NEXT 07:22`; `—` when only the catchable arrival exists | vitest |
| 7 | `viewmodel`: marker ratio | margin ≥ window → `0`; margin `0` → `1`; mid case matches `1 − margin/window` | vitest |
| 8 | Catchable selection + route code | earliest arrival with `leave_by ≥ now` chosen; a past one is skipped; `routeCode` = selected arrival's `serviceId` (array case picks the catchable route) | vitest |
| 9 | `buildViewModel` assembly | returns `wallClock` + exactly one full-width `ColumnViewModel` for one target | vitest |
| 10 | `bmp.tsx` renderer + `renderers` map + registry registration (no unit test — wasm; smoke via slice 11) | — | — |
| 11 | **End-to-end**: `wrangler dev` + curl against `bedroom-daughter` | 200, valid 64,862-byte BMP after gunzip, `X-Profile-Phase: morning_school_run`, `X-Sleep-Seconds` in range | wrangler + curl |
| 12 | Visual smoke: open `frame.bmp` | header wall-clock; mode icon **crisp** (no grey/AA — first live mode-icon render, per #5 comment); `LEAVE IN` hero; `BY`/`ARRIVES`; track + marker; `NEXT` | eyes |
| 13 | Hardware verification (final AC) | `bedroom-daughter` radiator renders `morning_school_run` end-to-end on the LilyGO panel; values match a manual Metlink check | hardware |

After green, sweep for refactor candidates (duplication between the two `viewmodel.ts` time-formatters is a likely lift to `shared/` — but only if it actually hurts; ADR-0005 "defaults stay light").

## Behaviours deliberately NOT in #5

- **Two transit targets / two-column split + hairline rule** — PRD §5.1 two-column case; follow-up.
- **Delayed banner, cancelled strike-through, no-service literal, promotion** — PRD §5.1 exception states; each its own slice. The `predicted`-time maths already *absorbs* delay; only the banner is deferred.
- **`idle_profile` layout + true fall-through** — issue #17. #5 only adds the resolver's window matching with a documented first-phase fallback.
- **~~KV cache + in-flight coalescing~~** — was #24; **dropped**, no caching layer ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)). `fetchArrivals` calls Metlink directly.
- **DST ambiguous-hour resolution** — documented non-goal.

## Verification

```bash
cd src/worker
echo "RADIATOR_SHARED_TOKEN=test-token-123" >  .dev.vars
echo "METLINK_API_KEY=<real-metlink-key>"   >> .dev.vars   # NEW for #5
pnpm install
pnpm dlx wrangler dev
```

```bash
# priority_split happy path (during the 07:15–08:30 window, or temporarily widen
# the seeded phase to all-day for an off-hours dev run)
curl -i -H "X-Radiator-Slug: bedroom-daughter" \
        -H "X-Radiator-Token: test-token-123" \
        -H "Accept-Encoding: gzip" --compressed \
        --output frame.bmp http://localhost:8787/v1/frame
# expect: 200, Content-Type image/bmp, Content-Encoding gzip,
#         X-Profile-Phase: morning_school_run, X-Sleep-Seconds in [30,14400]
stat -c %s frame.bmp     # 64862
xxd frame.bmp | head -1  # 42 4d (BM)
```

Plus the co-located unit suite:

```bash
pnpm test   # schedule/, config/, priority_split/ (+ unchanged minimal_clock/, auth/, gateways/metlink/) all green
```

Final AC — flash the `bedroom-daughter` radiator (firmware from #4; just point the slug + a stable tunnel/deploy URL at it) and confirm the panel renders `morning_school_run` with values matching a manual Metlink lookup at that moment.

## Out of scope (other issues)

- Two-target two-column `priority_split` — follow-up.
- Delayed / cancelled / no-service / promotion rendering — follow-ups.
- `idle_profile` layout + content — #17.
- 429 handling (ADR-0002 follow-up). (KV cache #24 — dropped, see ADR-0010.)
- JSON / SVG diagnostic renderers — #19 / #20.
- Production deploy + secret management — #12.

## References

- [#5](https://github.com/philipf/gotta-go/issues/5), [#23](https://github.com/philipf/gotta-go/issues/23) (done), [#24](https://github.com/philipf/gotta-go/issues/24) (closed — no cache, [ADR-0010](../adr/0010-no-metlink-cache-layer.md))
- `docs/glossary.md` §3, §5, §6, §7 — Leave In/By, Arrives In, Next, track/marker/window, time-to-stop/comfort-buffer/leave-margin
- `docs/PRD/GottaGo PRD v0.4.md` §5.1, §5.3, §5.4, §9
- `docs/adr/0002-metlink-stop-predictions-field-mapping.md` — field mapping + `service_id` schema extension
- `docs/adr/0005-worker-source-architecture.md` — folder shape, DI, co-located tests, `wrangler dev` integration seam
- `docs/plans/gh4-minimal-clock-frame.md` — the Worker + firmware baseline this slice extends
- `/tdd` skill — per-slice rhythm
