# Issue #17: `idle_jokes` layout + idle-profile fall-through

> **Scope decision (grilled 2026-05-31):** layout **and** the full ADR-0003 idle
> fall-through. One PR closes #17 end-to-end. Glossary/ADR doc updates are
> **explicitly out of scope for this PR** at the user's request — captured here
> and worth a follow-up.

## Context

ADR-0003 reserved the **idle profile** slot: when server time falls outside every
configured **profile phase** of a slug's profile, the Worker falls through to a
system-wide default and returns `200` with a frame and
`X-Sleep-Seconds = min(seconds_until_next_phase_start, 14400)`. What that frame
*shows* was deferred to #17.

Today `schedule/resolve.ts` has not yet implemented the fall-through — it carries
a literal `TODO(#17)` and falls back to `phases[0]`. This issue replaces that
TODO with the real behaviour and ships the first idle layout: `idle_jokes`.

The design intent is **ambient amusement, not utility** — the idle profile fires
overnight when nobody is expected to be looking. A glance should be rewarded with
a joke, not woken with bright information or a stale clock.

## Design decisions (all grilled)

| Decision | Choice | Rationale |
|---|---|---|
| **Layout name** | `idle_jokes` (content-specific) | A layout is a structural template (meme + joke block). Quotes would be a separate sibling. Matches the glossary's "one layout = one template" rule. |
| **Content source** | `icanhazdadjoke.com`, `Accept: application/json` → `{id, joke, status}`, custom `User-Agent` (repo URL) | `id` aids diagnostics; Worker already parses upstream JSON (Metlink). Built as a Fowler gateway mirroring `gateways/metlink/`. |
| **Rotation** | Per-wake random | The API's native behaviour — no seeding/state. Idle wakes are rare, so a handful of jokes per night naturally. |
| **Wall-clock / date** | **None** — pure meme + joke | Idle sleeps up to 4h; a clock rendered at 23:00 still reads 23:00 at 02:00. A stale clock is worse than no clock. |
| **Failure mode** | Treat like Metlink → `502 problem+json` (`joke-source-unavailable`, Retryable) → firmware error screen | Consistency with ADR-0011 over a special carve-out. No bundled fallback list. Sleeps at the idle phase cadence. |
| **Idle config shape** | Optional `Profile.idle` override + `SYSTEM_IDLE_DEFAULT` constant in `config/data.ts` | "System-wide default" with a per-profile escape hatch. Both resolve to `idle_jokes` today. |
| **Reachability** | Trim `philip_and_tania`'s `all_day_clock` (00:00–23:59) to a daytime `minimal_clock` (09:00–21:00) | The catch-all swallowed every hour, making idle dead code. New 21:00–06:30 gap falls through to idle. `daughter_school` already has a 21:00–07:15 gap. |
| **Visual** | Meme 30% left / joke 70% right; vertical splitter rule hugging the joke's left edge; upright DejaVu Sans Bold (no italic); word-wrapped, vertically centred; font size stepped by joke length | Italic dropped — Satori won't synthesize it and ADR-0009 bundles only Bold; splitter+indent reads better on e-ink anyway. |
| **Meme asset** | Yao Ming "Face" rage-comic, cleaned to a 1-bit PNG bundled in `assets/`, embedded as a base64 `<img>` data URI | Already line art → ideal for 1-bit. Bundled (not hot-linked from Etsy) to avoid a second failure mode + link rot. Attribution added. |

## Architecture (mirrors existing seams)

```
src/worker/
  gateways/icanhazdadjoke/        ← NEW, mirrors gateways/metlink/
    client.ts        GET / with Accept: application/json + User-Agent
    types.ts         WireJoke { id, joke, status }
    mapper.ts        wire → domain Joke { id, text }
    fixtures.ts      recorded sample payload(s)
    icanhazdadjoke.ts  facade: fetchJoke(): FetchResult; typed GatewayError bulkhead
    icanhazdadjoke.test.ts
  features/idle_jokes/             ← NEW, sibling to minimal_clock/
    viewmodel.ts     buildViewModel(joke) → { text, id, fontSize }
    view.tsx         meme 30% + splitter + joke 70%, length-bucketed font
    service.ts       render(ctx): fetch joke, throw jokeSourceUnavailable on failure
    idle_jokes.test.ts
  assets/
    yao-ming.png     ← NEW bundled 1-bit meme (+ ATTRIBUTION.md entry)
  shared/errors.ts   + 'joke-source-unavailable' slug + jokeSourceUnavailable() factory (RetryableError, 502)
  features/registry.ts  + idle_jokes
  config/types.ts    + Profile.idle?: { layout: LayoutKey }
  config/data.ts     + SYSTEM_IDLE_DEFAULT; trim all_day_clock → 09:00–21:00
  schedule/resolve.ts  idle fall-through: no phase match → idle profile + until-next-phase sleep
```

The `idle_jokes` renderer ignores the transit-only `RenderContext` fields exactly
as `minimal_clock` does; it uses `ctx.fetchFn`/`ctx.env` for the upstream call.

### Fall-through wiring (`schedule/resolve.ts`)

When `find()` matches no phase:
- `idle = radiator.profile.idle ?? SYSTEM_IDLE_DEFAULT` (both `{ layout: 'idle_jokes' }`)
- `profilePhase = 'idle_profile'` (the `X-Profile-Phase` value)
- synthesize a `ProfilePhase` (`key: 'idle_profile'`) for the `RenderContext` — `idle_jokes` ignores its fields
- `sleepSeconds = clamp(secondsUntilNextPhaseStart, 30, 14400)`, where the next
  start is `min` over all phases of `((startMins − nowMins + 1440) % 1440)`, treating
  `0` as a full day (a phase starting exactly now would have matched). Cross-midnight
  wrap handled by the modulo.

`api/frame.ts` already captures `phaseCadence = sleepSeconds` before rendering, so a
thrown `jokeSourceUnavailable` inherits the idle cadence for its `X-Sleep-Seconds`.

## TDD slice order

Per ADR-0005 + `/tdd`: one RED test → one GREEN minimal impl → optional REFACTOR.
The Satori→resvg BMP path is sandbox-blocked (per `minimal_clock.test.ts`), so unit
tests target the viewmodel / gateway / resolver; the rendered frame is verified live
via `pnpm dev` + curl.

| # | Slice | Test | Status |
|---|---|---|---|
| **0** | `shared/errors`: add `joke-source-unavailable` slug + `jokeSourceUnavailable()` factory (RetryableError, 502) | unit: factory returns 502 / Retryable / correct slug | ✅ |
| **1** | `gateways/icanhazdadjoke` client+types+mapper+fixtures+facade | unit: mapper wire→domain; facade classifies ok / network / upstream via stub fetch | ✅ |
| **2** | `features/idle_jokes/viewmodel` | unit: `buildViewModel(joke)` returns `{ text, id, fontSize }`; long joke → smaller bucket than short | ✅ |
| **3** | `features/idle_jokes/view.tsx` (meme + splitter + joke) | no unit (sandbox); live curl | ✅ |
| **4** | `features/idle_jokes/service` | unit: stub fetch ok → viewModel (format json, no bmp); stub fetch fail → throws `jokeSourceUnavailable` | ✅ |
| **5** | `features/registry`: register `idle_jokes` | typecheck (LayoutKey union) | ✅ |
| **6** | `config`: `Profile.idle` type + `SYSTEM_IDLE_DEFAULT`; trim `all_day_clock` → 09:00–21:00 | unit: config shape; existing config.test passes | ✅ |
| **7** | `schedule/resolve`: idle fall-through + until-next-phase sleep | unit: overnight `now` → `idle_profile`, layout `idle_jokes`, sleep in [30,14400]; wrap-around correct; in-window unchanged | ✅ |
| **8** | End-to-end: `pnpm dev` + curl with `X-Debug-Now` at 23:00 → 200, `X-Profile-Phase: idle_profile`, valid BMP; visual smoke | curl + eyes | ✅ |
| **9** | Asset: convert meme → 1-bit `yao-ming.png`, add wrangler `.png` Data rule + `assets.d.ts` decl + ATTRIBUTION entry | bundles; renders in frame | ✅ |

## Verification

```bash
cd src/worker
# .dev.vars must carry RADIATOR_SHARED_TOKEN and DEV_TIME_OVERRIDE=true
pnpm dlx wrangler dev
# Overnight time → idle fall-through → idle_jokes
curl -i -H "X-Radiator-Slug: bedroom-philip-tania" \
       -H "X-Radiator-Token: $TOKEN" \
       -H "X-Debug-Now: 2026-05-31T23:00:00+12:00" \
       -H "Accept-Encoding: gzip" --compressed -o idle.bmp \
       http://localhost:8787/v1/frame
# expect: 200, X-Profile-Phase: idle_profile, X-Sleep-Seconds in [30,14400]
# JSON variant to inspect the joke without rasterising:
curl -s -H "X-Radiator-Slug: bedroom-philip-tania" -H "X-Radiator-Token: $TOKEN" \
       -H "X-Debug-Now: 2026-05-31T23:00:00+12:00" -H "Accept: application/json" \
       http://localhost:8787/v1/frame | jq
pnpm test   # all unit slices green
```

## Out of scope (deferred)

- **Glossary §2/§7 + PRD §5 + UI mockup + ADR updates** — explicitly skipped this PR
  per user. The acceptance criteria's doc items remain open; worth a follow-up.
- **`idle_quotes` or any second idle layout** — `idle_jokes` is the only one today.
- **Per-radiator joke config / curated lists** — `SYSTEM_IDLE_DEFAULT` is system-wide;
  the `Profile.idle` override exists but only selects a layout.

## References

- [ADR-0003](../adr/0003-radiator-worker-contract.md) §"Idle profile"
- [ADR-0005](../adr/0005-worker-source-architecture.md) — gateway tier, feature folders, DI
- [ADR-0011](../adr/0011-error-contract-problem-details.md) — problem+json error contract
- `gateways/metlink/` + `features/minimal_clock/` — the patterns mirrored here
