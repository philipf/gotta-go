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
import type { DepartureSlot, LastSlot, LaterRow, NoServiceSlot, PrioritySplitV2ViewModel, ServiceColumn } from './viewmodel';

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

// A plain ASCII hyphen-minus for the negative Leave In ("-1 MIN") and the EARLY
// badge. The wider Unicode minus (U+2212) read as too long on the panel (#108),
// so the hyphen is used instead.
const MINUS = '-';

function minutesUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / MS_PER_MIN;
}

// An operator-cancelled departure (glossary cancelled service, #106). It keeps
// its chronological slot but carries no actionable leave time — the renderer
// shows only its struck scheduled clock.
function isCancelled(a: Arrival): boolean {
  return a.status === 'cancelled';
}

// The bare struck **scheduled** clock for a cancelled departure (#106) — its
// timetable time, struck through by the renderer. A cancelled service never
// arrives, so the arrival-clock position repurposes to carry this scheduled
// time; the other value fields go empty.
function cancelledClock(a: Arrival, tz: string): string {
  return hhmm(a.scheduled, tz);
}

// The schedule-deviation badge for a departure — the explicit label naming how
// far its predicted arrival has drifted from the timetable (#105, glossary
// delayed/early service). `delaySeconds` is the signed drift: positive late,
// negative early. Rounded to whole minutes, `DELAYED +n MIN` at +1 min or later
// (good news — grows Leave In), `EARLY −n MIN` at 1 min or more early (bad news —
// shrinks Leave In, leave sooner), and null when it rounds to zero (on time — no
// badge). Leave In / Leave By / arrival are already computed against `predicted`
// (= arrival.expected), so the badge only *names* the deviation those figures
// already reflect; it does not recompute them.
function deviationBadge(a: Arrival): string | null {
  const deltaMins = Math.round(a.delaySeconds / 60);
  if (deltaMins >= 1) return `DELAYED +${deltaMins} MIN`;
  if (deltaMins <= -1) return `EARLY ${MINUS}${-deltaMins} MIN`;
  return null;
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
// negative ("-1 MIN") by design — the leave time is behind the rider. The LAST
// row carries no deviation badge (#108): it is the most compact row and the
// badge overran the split column, and a just-missed service's deviation is moot
// — you have already missed it, so why does not change the next action.
function buildLastSlot(a: Arrival, target: TransitTarget, tz: string, now: Date, runLimitMins: number): LastSlot {
  // A cancelled just-missed service renders struck with no RUN/MISSED tag — it
  // was never catchable, so the tag would be meaningless (#106).
  if (isCancelled(a)) {
    return {
      tag: '',
      leaveIn: '',
      arrives: cancelledClock(a, tz),
      deviation: null,
      cancelled: true,
      routePrefix: rowRoutePrefix(a, target),
    };
  }
  const minutesLate = -Math.round(minutesUntil(a.predicted, now) - target.timeToStopMins);
  return {
    tag: minutesLate <= runLimitMins ? 'RUN' : 'MISSED',
    leaveIn: `${MINUS}${minutesLate} MIN`,
    arrives: `ARR ${hhmm(a.predicted, tz)}`,
    deviation: null, // omitted on the LAST row (#108) — see the note above
    cancelled: false,
    routePrefix: rowRoutePrefix(a, target),
  };
}

function fallbackRouteId(target: TransitTarget): string {
  return Array.isArray(target.serviceId) ? target.serviceId[0] : target.serviceId;
}

// The per-row service-id prefix (#107). For an any-of `serviceId` target,
// successive departures under one column header may be different routes, so each
// rendered row (NEXT, THEN, LATER, LAST) carries its own service id to keep them
// distinguishable. A single-route target needs no prefix — the column header
// already names its one route — so it renders bare ('').
function rowRoutePrefix(a: Arrival, target: TransitTarget): string {
  return Array.isArray(target.serviceId) ? a.serviceId : '';
}

// Projects one upcoming departure into a hero slot. `isNext` enables the NOW
// zero-state: Leave In rendering `NOW` is the floor of the NEXT slot only — a
// THEN departure that rounds to zero shows "0 MIN" (it is, by construction,
// never sooner than NEXT, so this is a degenerate near-tie, not a real NOW).
function buildSlot(a: Arrival, target: TransitTarget, tz: string, now: Date, isNext: boolean): DepartureSlot {
  // A cancelled departure keeps its hero slot but shows only its struck
  // scheduled clock — the LEAVE IN label and value are suppressed and the real
  // leave-time number falls to the next live hero below (#106).
  if (isCancelled(a)) {
    return {
      leaveIn: '',
      leaveBy: '',
      arrives: cancelledClock(a, tz),
      deviation: null,
      cancelled: true,
      routePrefix: rowRoutePrefix(a, target),
    };
  }
  const leaveInMins = Math.max(0, Math.round(minutesUntil(a.predicted, now) - target.timeToStopMins));
  return {
    leaveIn: leaveInMins === 0 && isNext ? 'NOW' : `${leaveInMins} MIN`,
    leaveBy: `BY ${hhmm(leaveByTime(a, target), tz)}`,
    arrives: `ARR ${hhmm(a.predicted, tz)}`,
    deviation: deviationBadge(a),
    cancelled: false,
    routePrefix: rowRoutePrefix(a, target),
  };
}

// Projects one upcoming departure into a compact LATER row: Leave In minutes
// and the bare arrival clock. Always positive minutes — a LATER departure
// follows both heroes, so it never reaches the NEXT slot's NOW zero-state.
function buildLaterRow(a: Arrival, target: TransitTarget, tz: string, now: Date): LaterRow {
  // A cancelled LATER departure renders its scheduled clock struck, with no
  // Leave In (#106).
  if (isCancelled(a)) {
    return { leaveIn: '', arrives: cancelledClock(a, tz), deviation: null, cancelled: true, routePrefix: rowRoutePrefix(a, target) };
  }
  const leaveInMins = Math.max(0, Math.round(minutesUntil(a.predicted, now) - target.timeToStopMins));
  return {
    leaveIn: `${leaveInMins} MIN`,
    arrives: hhmm(a.predicted, tz),
    deviation: deviationBadge(a),
    cancelled: false,
    routePrefix: rowRoutePrefix(a, target),
  };
}

function buildColumn(target: TransitTarget, state: StopState, tz: string, now: Date, runLimitMins: number): ServiceColumn {
  // A closed stop is a successful (empty) fetch — no upcoming departures, both
  // slots dash. A gateway *error* never reaches here: prepare throws it (#59).
  const arrivals = state.kind === 'closed' ? [] : state.arrivals;
  const upcoming = selectUpcoming(arrivals, target, now);
  // LAST is derived from the same arrivals — no extra fetch, no persisted state.
  const justMissed = selectJustMissed(arrivals, target, now);
  const last = justMissed ? buildLastSlot(justMissed, target, tz, now, runLimitMins) : null;

  // The 60-min horizon now governs **every** upcoming slot, not just LATER: a
  // departure beyond it is too far off to plan around (priority_split_v2_delta
  // §4). NEXT / THEN / LATER are filled from the in-horizon departures only, in
  // chronological order, so the column renders fewer slots when fewer exist.
  // Because `upcoming` is sorted by arrival, the in-horizon departures are a
  // prefix of it.
  const inHorizon = upcoming.filter((a) => minutesUntil(a.predicted, now) <= HORIZON_MINS);

  // No-service: nothing within the horizon. NEXT shows `NO SERVICE` with the
  // next available departure clock (the soonest upcoming beyond the horizon, if
  // any); THEN and LATER are suppressed; the LAST row may still render (#106). A
  // cancelled departure *within* the horizon is still a departure — it shows
  // struck in its slot, so it does not trigger the no-service state.
  if (inHorizon.length === 0) {
    const nextUp = upcoming[0];
    return {
      mode: target.mode,
      serviceId: nextUp ? nextUp.serviceId : fallbackRouteId(target),
      tripHeadsign: '',
      last,
      noService: { nextDeparture: nextUp ? hhmm(nextUp.predicted, tz) : null },
      next: null,
      then: null,
      later: [],
    };
  }

  const next = inHorizon[0];
  const then = inHorizon[1];
  const later = inHorizon.slice(2, 2 + LATER_COUNT).map((a) => buildLaterRow(a, target, tz, now));

  return {
    mode: target.mode,
    // The header names the NEXT departure's service; a cancelled NEXT still
    // carries its route id/headsign, so the column keeps identifying its route.
    serviceId: next.serviceId,
    tripHeadsign: next.tripHeadsign,
    last,
    noService: null,
    next: buildSlot(next, target, tz, now, true),
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
