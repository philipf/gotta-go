# ADR-0015: Profile-phase active days are a weekday filter on the active match; the next-boundary scan stays day-agnostic

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — "Active days"
- **Related contracts:** [ADR-0003](0003-radiator-worker-contract.md) (§"Idle profile" — the fall-through this leans on), #92 (implementation), #87 (parent)

## Context

`ProfilePhase` had no day-of-week concept — every phase fired seven days a
week. Commute and school-run phases are weekday rituals; on weekends they burn
battery and Metlink calls for nobody. The motivating case is the office-f5
radiator's `office_afternoon_commute` (15:00–19:30, 1-minute refresh): at an
unattended desk it woke ~270 times per weekend day of pure waste.

Two facts about the resolver shape the decision:

1. **Sleep is already capped at the 4 h ceiling** (`SLEEP_CEILING`, glossary
   §8), and the radiator **re-resolves from scratch on every wake**. So no
   single nap ever exceeds 4 h regardless of how far away the next eligible
   phase is.
2. The resolver has two outputs — *which phase to show* (correctness) and
   *how long to sleep* (battery). These are separable.

The #87 sketch proposed teaching `minutesUntilNextPhaseStart` to scan **across
day boundaries** for the next *eligible* phase start, "rather than assuming
tomorrow repeats today."

## Decision

1. **Add an optional `days?: Weekday[]` field to `ProfilePhase`** — lowercase
   three-letter tokens (`mon`–`sun`), a plain string-union array. Absent means
   every day (the common case; existing phases unchanged). The glossary names
   the concept **"Active days"**. No cron grammar, no range sugar, no
   `weekday`/`weekend` aliases: the phases already encode time via
   `start_time`/`end_time`, so a day-of-week field is all that is missing, and
   a union type makes a bad token a compile error.

2. **The weekday filter applies to the active-phase match only.** A phase is
   active when its half-open `[start, end)` window contains the local
   (Pacific/Auckland) time **and** (`days` absent **or** `days` includes
   today's local weekday). Otherwise the normal rules apply — the resolver
   falls through to the next eligible phase or the idle profile. A disabled
   phase is simply *not there*; nothing else changes.

3. **`minutesUntilNextPhaseStart` stays day-agnostic** — we decline the
   cross-day scan. Correctness comes entirely from (2): a weekday-only phase
   never *shows* on its off-day. The only residual effect of the day-agnostic
   boundary scan is on *wake timing*: a long calendar sleep may be truncated at
   a disabled phase's start (e.g. a Saturday calendar wakes at the weekday
   commute's start), re-resolve to the same phase, and sleep on — roughly one
   or two **self-correcting** wakes per weekend day, never a wrong frame, all
   bounded by the 4 h cap.

4. **The `test-<phaseKey>` scenario slugs (#21) strip `days`.** The synthetic
   radiator already widens a phase to all-day so it renders regardless of
   wall-clock; it now also drops `days` so a weekday-only phase renders its
   intent on a weekend. `X-Debug-Now` remains the tool for exercising *real*
   weekday selection.

5. **Weekday derivation lives in `shared/weekday.ts`** — a memoised
   `Intl.DateTimeFormat` mirroring `shared/hhmm.ts`, returning the `Weekday`
   token directly. DST never shifts the calendar day in NZ, so it is
   day-correct year round.

Applied in the seed config to exactly four phases — `morning_commute`,
`afternoon_commute`, `office_afternoon_commute`, `morning_school_run` — as
`mon`–`fri`. Calendars and the daughter's idle clock stay every-day. An empty
`days` array is forbidden by a `config.test.ts` invariant (a silent dead phase
the union type cannot catch).

### Rejected: the cross-day forward scan (the #87 sketch)

Teaching `minutesUntilNextPhaseStart` to look forward up to seven days for the
next eligible start would eliminate the one-or-two self-correcting weekend
wakes. It buys nothing on the *correctness* axis (the active-match filter
already handles that) and its battery saving is dwarfed by the 4 h cap, which
already wakes the radiator at least six times across any idle stretch. The cost
is a forward-scanning loop with its own edge cases (all-phases-disabled-today,
midnight wrap, the empty-array degenerate). Not worth it; revisit only if the
4 h cap is ever raised substantially.

## Consequences

### Positive

- The office desk drops from ~270 weekend wakes/day to a handful; the bedroom
  and daughter radiators stop their weekend commute/school chatter too.
- The change is two concerns cleanly split: a one-line predicate on the active
  match, and seed config. The hot path gains no day-boundary loop.
- The bedroom's every-day `daytime_calendar` backfills its weekend afternoons
  for free; expressing "keep the calendar up on weekends" needs no new
  mechanism — just a phase whose `days` are disjoint from the commute's.

### Negative / trade-offs

- A weekday-only phase leaves a gap on weekends that falls through to idle
  (e.g. the office desk shows `idle_jokes` 15:00–19:30 on weekends). Accepted;
  authoring a `sat`/`sun` phase is the escape hatch if that is ever unwanted.
- `minutesUntilNextPhaseStart` knowingly ignores `days`, so a reader who does
  not know this ADR might mistake the one-or-two weekend wakes for a bug. This
  ADR and the resolver comment are the guard against that.
- Office "full-day coverage / idle never engages" (ADR-0003-era assumption,
  #86) is now **weekday-only**.

## References

- [ADR-0003](0003-radiator-worker-contract.md) — idle profile fall-through and the 4 h sleep cap this leans on
- `schedule/resolve.ts` — the active-match filter; `minutesUntilNextPhaseStart` deliberately day-agnostic
- `shared/weekday.ts` — tz-correct weekday token, sibling of `shared/hhmm.ts`
- `api/test-frame.ts` — the `days`-strip for scenario slugs
- #92 (implementation), #87 (parent)
