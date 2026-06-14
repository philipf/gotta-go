// Data contract for priority_split_v2: the format-agnostic ViewModel and its
// JSON projection. The v2 slot model renders the next two **upcoming**
// departures as two co-equal heroes — NEXT and THEN — rather than v1's single
// catchable hero plus a NEXT-times footer (issue #102, glossary LAST/NEXT/
// THEN/LATER slot model).

import type { Mode } from './mode-icon';

// One co-equal hero: a single upcoming departure. `LEAVE IN` is the headline
// (the value the rider acts on); `BY hh:mm` and the arrival clock `ARR hh:mm`
// qualify it. v2 drops v1's `ARRIVES IN n MIN` — the hero carries the arrival
// **clock** only.
//
// `cancelled` flags an operator-cancelled departure (#106): it keeps its
// chronological slot but carries **no actionable leave time**. When cancelled,
// `leaveIn`/`leaveBy` are empty and `deviation` is null; `arrives` carries the
// bare **struck scheduled clock** (`hh:mm`, no `ARR ` prefix — a cancelled
// service never arrives, so the arrival position repurposes to show the struck
// scheduled time the renderer strikes through). No `CANCELLED` text label — the
// strike-through is the signal (glossary cancelled service).
export type DepartureSlot = {
  leaveIn: string; // "7 MIN" | "NOW" — empty when cancelled
  leaveBy: string; // "BY 07:08" — empty when cancelled
  arrives: string; // "ARR 07:14" — arrival clock; bare struck "07:14" when cancelled
  deviation: string | null; // "DELAYED +3 MIN" | "EARLY −2 MIN" | null when on time (#105) / cancelled
  cancelled: boolean; // operator-cancelled — render arrives struck, no Leave In (#106)
  routePrefix: string; // this departure's service id ("635") for an any-of target; '' for single-route (#107)
};

// One LATER row: a departure after THEN, rendered compactly as `n MIN BY hh:mm`
// (Leave In + Leave By clock, no separator) — the `LEAVE IN` label is dropped,
// the row's position under the THEN hero carries that meaning, and the `BY`
// names the clock so it is not mistaken for an arrival (#108). Always a positive
// Leave In: every LATER departure follows the two heroes, so it never reaches
// the NEXT slot's NOW zero-state. When `cancelled`, `leaveIn` is empty and
// `clock` carries the bare struck scheduled clock (#106).
export type LaterRow = {
  leaveIn: string; // "29 MIN" — empty when cancelled
  clock: string; // "BY 08:31" — the Leave By clock; bare struck scheduled clock when cancelled (#108)
  deviation: string | null; // "DELAYED +3 MIN" | "EARLY −2 MIN" | null when on time (#105) / cancelled
  cancelled: boolean; // operator-cancelled — render clock struck, no Leave In (#106)
  routePrefix: string; // this departure's service id ("635") for an any-of target; '' for single-route (#107)
};

// The LAST row: the single just-missed service (its Leave By has passed but it
// has not yet reached the stop), echoed as one compact line until the floor
// (`now ≥ arrival_time`) hides it (#104, glossary just-missed service). Unlike
// a hero it carries a state tag and a *negative* Leave In by design, and no
// `LEAVE BY` — the rider's leave time is already behind them. A cancelled
// service in the LAST position renders struck with **no RUN/MISSED tag** — it
// was never catchable, so the tag would be meaningless (#106); `tag`/`leaveIn`
// are empty and `arrives` carries the bare struck scheduled clock.
export type LastSlot = {
  tag: string; // "RUN" | "MISSED" — split at the RUN limit; empty when cancelled
  leaveIn: string; // "−1 MIN" — negative by design; empty when cancelled
  arrives: string; // "ARR 08:07" — arrival clock; bare struck "08:07" when cancelled
  deviation: string | null; // "DELAYED +3 MIN" | "EARLY −2 MIN" | null when on time (#105) / cancelled
  cancelled: boolean; // operator-cancelled just-missed service — struck, no tag (#106)
  routePrefix: string; // this departure's service id ("635") for an any-of target; '' for single-route (#107)
};

// The no-service state of a column (#106, glossary no-service state): no
// departure falls within the next 60-minute horizon, so the NEXT slot is
// replaced by the literal `NO SERVICE` with the next available departure clock
// below it, and THEN / LATER are suppressed. `nextDeparture` is the soonest
// upcoming departure's clock (beyond the horizon), or null when the feed has no
// further departure at all.
export type NoServiceSlot = {
  nextDeparture: string | null; // "08:45" — the next available departure clock, or null when none
};

// A transit target's column: the header (mode + service name), the just-missed
// LAST row, the two hero slots, and the LATER list. `null` for `last` or a hero
// slot means the live feed carries no departure there — the renderer dashes (or
// omits) it. `later` is the departures after THEN within the 60-min horizon (up
// to LATER_COUNT); empty when none follow, in which case the renderer dashes the
// section. When `noService` is set, no departure falls within the 60-min
// horizon: the renderer shows `NO SERVICE` in the NEXT position and suppresses
// THEN / LATER (which are null / empty), while `last` may still render (#106).
export type ServiceColumn = {
  mode: Mode;
  serviceId: string; // NEXT departure's service id, e.g. "1"; falls back to the target's first id when empty
  tripHeadsign: string; // NEXT departure's destination headsign; '' when unknown
  last: LastSlot | null; // the just-missed service, or null when none is within the LAST window
  noService: NoServiceSlot | null; // the no-service state, or null when a departure is within the horizon (#106)
  next: DepartureSlot | null; // soonest upcoming departure within the horizon; null in the no-service state
  then: DepartureSlot | null; // the departure after NEXT
  later: LaterRow[]; // departures after THEN, oldest-first; empty when none follow
};

export type PrioritySplitV2ViewModel = {
  wallClock: string; // global header — "07:30"
  date: string; // global header — "Sat 31 May" (confirms the frame is fresh, #46)
  columns: ServiceColumn[]; // one per transit target; single → full width
};

// Serialises a slot to its snake_case wire shape, or null when absent.
function slotJson(slot: DepartureSlot | null): Record<string, unknown> | null {
  return slot === null
    ? null
    : {
        leave_in: slot.leaveIn,
        leave_by: slot.leaveBy,
        arrives: slot.arrives,
        deviation: slot.deviation,
        cancelled: slot.cancelled,
        route_prefix: slot.routePrefix,
      };
}

// Serialises one LATER row to its snake_case wire shape.
function laterJson(row: LaterRow): Record<string, unknown> {
  return { leave_in: row.leaveIn, clock: row.clock, deviation: row.deviation, cancelled: row.cancelled, route_prefix: row.routePrefix };
}

// Serialises the LAST row to its snake_case wire shape, or null when there is
// no just-missed service in the window. No `leave_by` — the LAST row never
// carries one.
function lastJson(slot: LastSlot | null): Record<string, unknown> | null {
  return slot === null
    ? null
    : {
        tag: slot.tag,
        leave_in: slot.leaveIn,
        arrives: slot.arrives,
        deviation: slot.deviation,
        cancelled: slot.cancelled,
        route_prefix: slot.routePrefix,
      };
}

// Serialises the no-service state to its snake_case wire shape, or null when the
// column has a departure within the horizon.
function noServiceJson(slot: NoServiceSlot | null): Record<string, unknown> | null {
  return slot === null ? null : { next_departure: slot.nextDeparture };
}

// Serialises the view model for the JSON diagnostics envelope (ADR-0004): maps
// the renderer's camelCase fields to their snake_case wire names. The values
// are exactly the strings Satori is fed, so the JSON view is a serialiser of
// the rendered type, never a parallel definition.
export function toJsonView(vm: PrioritySplitV2ViewModel): Record<string, unknown> {
  return {
    wall_clock: vm.wallClock,
    date: vm.date,
    columns: vm.columns.map((c) => ({
      mode: c.mode,
      service_id: c.serviceId,
      trip_headsign: c.tripHeadsign,
      last: lastJson(c.last),
      no_service: noServiceJson(c.noService),
      next: slotJson(c.next),
      then: slotJson(c.then),
      later: c.later.map(laterJson),
    })),
  };
}

// Composes the **service name** — the column-header label answering "which
// service is this", combining `service_id` (e.g. "1") with the human-readable
// `trip_headsign` (e.g. "Island Bay") as `1 · Island Bay` (glossary §2). Kept
// here rather than in view.tsx so it stays unit-testable without the Satori
// path that is sandbox-blocked in vitest (ADR-0005).
const SERVICE_NAME_SEP = ' · ';

// Drop the separator and show the id alone when the headsign is empty, rather
// than rendering a dangling "1 · ".
export function serviceName(serviceId: string, tripHeadsign: string): string {
  return tripHeadsign ? `${serviceId}${SERVICE_NAME_SEP}${tripHeadsign}` : serviceId;
}
