// Domain service for priority_split_v2: turns fetched StopStates into the view
// model — the domain-granularity test seam between the gateway fetch and the
// NEXT/THEN slot derivation. From a target's arrivals it builds the
// chronological list of **upcoming** departures (those whose Leave By has not
// passed) and projects the first two into co-equal hero slots (issue #102).

import type { Arrival, StopState } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
import type { DepartureSlot, PrioritySplitV2ViewModel, ServiceColumn } from './viewmodel';

const MS_PER_MIN = 60_000;

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

function buildColumn(target: TransitTarget, state: StopState, tz: string, now: Date): ServiceColumn {
  // A closed stop is a successful (empty) fetch — no upcoming departures, both
  // slots dash. A gateway *error* never reaches here: prepare throws it (#59).
  const upcoming = state.kind === 'closed' ? [] : selectUpcoming(state.arrivals, target, now);
  const next = upcoming[0];
  const then = upcoming[1];

  return {
    mode: target.mode,
    // The header names the NEXT departure's service; with no departure at all
    // it falls back to the target's first configured id so the column still
    // identifies its route.
    serviceId: next ? next.serviceId : fallbackRouteId(target),
    tripHeadsign: next ? next.tripHeadsign : '',
    next: next ? buildSlot(next, target, tz, now, true) : null,
    then: then ? buildSlot(then, target, tz, now, false) : null,
  };
}

// Assembles the full layout view model from already-fetched gateway states: the
// wall-clock global header plus one column per transit target (states aligned
// by index with targets). A single target yields one column, which the renderer
// auto-scales to full frame width. Exported as the domain-granularity test seam;
// production code reaches it only through the prepare capability.
export function viewModelFromStopStates(targets: TransitTarget[], states: StopState[], tz: string, now: Date): PrioritySplitV2ViewModel {
  return {
    wallClock: hhmm(now, tz),
    date: shortDate(now, tz),
    columns: targets.map((target, i) => buildColumn(target, states[i], tz, now)),
  };
}
