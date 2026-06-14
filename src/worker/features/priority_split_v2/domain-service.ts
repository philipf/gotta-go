// Domain service for priority_split_v2: turns fetched StopStates into the view
// model — the domain-granularity test seam between the gateway fetch and the
// NEXT/THEN slot derivation. From a target's arrivals it builds the
// chronological list of **upcoming** departures (those whose Leave By has not
// passed), projects the first two into co-equal hero slots (issue #102) and the
// rest — within a 60-min horizon — into the compact LATER list (issue #103),
// plus the single just-missed service on the LAST row (issue #104).

import type { Arrival, StopState } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
import type { DepartureSlot, LastSlot, LaterRow, PrioritySplitV2ViewModel, ServiceColumn } from './viewmodel';

const MS_PER_MIN = 60_000;

// LATER renders up to this many departures below THEN — a fixed render constant
// (pixel fit, nothing about a phase changes it), not a per-phase setting
// (priority_split_v2_delta §6).
const LATER_COUNT = 3;

// LATER only shows departures within the next hour; anything beyond is too far
// off to plan around (priority_split_v2_delta §4).
const HORIZON_MINS = 60;

// The RUN limit (glossary): the largest lateness, in minutes, at which a
// just-missed service is still sprintable and tagged RUN. Applied here so the
// "default 1 min" rule lives with the RUN/MISSED logic it governs; a profile
// phase overrides it via runLimitMins (#104).
const DEFAULT_RUN_LIMIT_MINS = 1;

// The Unicode minus sign (U+2212), not a hyphen — the LAST row's Leave In is
// negative by design ("−1 MIN") and U+2212 reads as a proper minus on the
// 1-bit panel, matching the reference mockup.
const MINUS = '−';

function minutesUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / MS_PER_MIN;
}

// leave_by_time = arrival_time − time_to_stop_mins (glossary §3).
function leaveByTime(a: Arrival, target: TransitTarget): Date {
  return new Date(a.predicted.getTime() - target.timeToStopMins * MS_PER_MIN);
}

// The chronological **upcoming** departures: sorted by arrival, keeping only
// those whose leave_by_time has not yet passed (glossary §4). A departure you
// can no longer make is dropped, so upcoming[0] is the soonest you can still
// catch — the NEXT slot — and upcoming[1] is THEN.
function selectUpcoming(arrivals: Arrival[], target: TransitTarget, now: Date): Arrival[] {
  return [...arrivals]
    .sort((a, b) => a.predicted.getTime() - b.predicted.getTime())
    .filter((a) => leaveByTime(a, target).getTime() >= now.getTime());
}

// The single **just-missed** service for the LAST row (#104): the most-recently-
// departed service whose leave_by has passed (`leave_by < now`) but which has
// not yet reached the stop (`now < arrival_time`), so it is still in the live
// feed. When several qualify (frequent service + a long walk) only the most
// recent shows — older missables are dropped. Because time_to_stop is constant
// per target, the most recent is simply the latest by arrival, so we sort
// ascending and take the last. The floor (`now ≥ arrival_time`) is enforced by
// the upper bound here, so a service that has reached the stop falls out — which
// also coincides with it leaving the feed.
function selectJustMissed(arrivals: Arrival[], target: TransitTarget, now: Date): Arrival | undefined {
  return [...arrivals]
    .filter((a) => leaveByTime(a, target).getTime() < now.getTime() && now.getTime() < a.predicted.getTime())
    .sort((a, b) => a.predicted.getTime() - b.predicted.getTime())
    .at(-1);
}

// Projects the just-missed service into the LAST row. minutes_late = −leave_in
// and is always ≥ 1 here (leave_by has passed). RUN while it is small enough to
// sprint (`minutes_late ≤ runLimit`), MISSED above. The Leave In renders
// negative ("−1 MIN") by design — the leave time is behind the rider.
function buildLastSlot(a: Arrival, target: TransitTarget, tz: string, now: Date, runLimitMins: number): LastSlot {
  const minutesLate = -Math.round(minutesUntil(a.predicted, now) - target.timeToStopMins);
  return {
    tag: minutesLate <= runLimitMins ? 'RUN' : 'MISSED',
    leaveIn: `${MINUS}${minutesLate} MIN`,
    arrives: `ARR ${hhmm(a.predicted, tz)}`,
  };
}

function fallbackRouteId(target: TransitTarget): string {
  return Array.isArray(target.serviceId) ? target.serviceId[0] : target.serviceId;
}

// Projects one upcoming departure into a hero slot. `isNext` enables the NOW
// zero-state: Leave In rendering `NOW` is the floor of the NEXT slot only — a
// THEN departure that rounds to zero shows "0 MIN" (it is, by construction,
// never sooner than NEXT, so this is a degenerate near-tie, not a real NOW).
function buildSlot(a: Arrival, target: TransitTarget, tz: string, now: Date, isNext: boolean): DepartureSlot {
  const leaveInMins = Math.max(0, Math.round(minutesUntil(a.predicted, now) - target.timeToStopMins));
  return {
    leaveIn: leaveInMins === 0 && isNext ? 'NOW' : `${leaveInMins} MIN`,
    leaveBy: `BY ${hhmm(leaveByTime(a, target), tz)}`,
    arrives: `ARR ${hhmm(a.predicted, tz)}`,
  };
}

// Projects one upcoming departure into a compact LATER row: Leave In minutes
// and the bare arrival clock. Always positive minutes — a LATER departure
// follows both heroes, so it never reaches the NEXT slot's NOW zero-state.
function buildLaterRow(a: Arrival, target: TransitTarget, tz: string, now: Date): LaterRow {
  const leaveInMins = Math.max(0, Math.round(minutesUntil(a.predicted, now) - target.timeToStopMins));
  return {
    leaveIn: `${leaveInMins} MIN`,
    arrives: hhmm(a.predicted, tz),
  };
}

function buildColumn(target: TransitTarget, state: StopState, tz: string, now: Date, runLimitMins: number): ServiceColumn {
  // A closed stop is a successful (empty) fetch — no upcoming departures, both
  // slots dash. A gateway *error* never reaches here: prepare throws it (#59).
  const arrivals = state.kind === 'closed' ? [] : state.arrivals;
  const upcoming = selectUpcoming(arrivals, target, now);
  const next = upcoming[0];
  const then = upcoming[1];
  // LAST is derived from the same arrivals — no extra fetch, no persisted state.
  const justMissed = selectJustMissed(arrivals, target, now);

  // LATER is the departures after THEN, keeping only those arriving within the
  // 60-min horizon and capped at LATER_COUNT. Fewer rows render when fewer
  // follow; an empty list dashes the section.
  const later = upcoming
    .slice(2)
    .filter((a) => minutesUntil(a.predicted, now) <= HORIZON_MINS)
    .slice(0, LATER_COUNT)
    .map((a) => buildLaterRow(a, target, tz, now));

  return {
    mode: target.mode,
    // The header names the NEXT departure's service; with no departure at all
    // it falls back to the target's first configured id so the column still
    // identifies its route.
    serviceId: next ? next.serviceId : fallbackRouteId(target),
    tripHeadsign: next ? next.tripHeadsign : '',
    last: justMissed ? buildLastSlot(justMissed, target, tz, now, runLimitMins) : null,
    next: next ? buildSlot(next, target, tz, now, true) : null,
    then: then ? buildSlot(then, target, tz, now, false) : null,
    later,
  };
}

// Assembles the full layout view model from already-fetched gateway states: the
// wall-clock global header plus one column per transit target (states aligned
// by index with targets). A single target yields one column, which the renderer
// auto-scales to full frame width. Exported as the domain-granularity test seam;
// production code reaches it only through the prepare capability.
export function viewModelFromStopStates(
  targets: TransitTarget[],
  states: StopState[],
  tz: string,
  now: Date,
  runLimitMins: number = DEFAULT_RUN_LIMIT_MINS,
): PrioritySplitV2ViewModel {
  return {
    wallClock: hhmm(now, tz),
    date: shortDate(now, tz),
    columns: targets.map((target, i) => buildColumn(target, states[i], tz, now, runLimitMins)),
  };
}
