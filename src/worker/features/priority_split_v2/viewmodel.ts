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
export type DepartureSlot = {
  leaveIn: string; // "7 MIN" | "NOW" (NOW is the zero-state of the NEXT slot only)
  leaveBy: string; // "BY 07:08"
  arrives: string; // "ARR 07:14" — arrival clock, no "ARRIVES IN n MIN"
};

// One LATER row: a departure after THEN, rendered compactly as `n MIN · hh:mm`
// (Leave In + bare arrival clock) — no `LEAVE IN`/`BY`/`ARR` labels, the row's
// position under the THEN hero carries the meaning. Always a positive Leave In:
// every LATER departure follows the two heroes, so it never reaches the NEXT
// slot's NOW zero-state.
export type LaterRow = {
  leaveIn: string; // "29 MIN"
  arrives: string; // "08:37" — arrival clock only, no "ARR " prefix
};

// A transit target's column: the header (mode + service name), the two hero
// slots, and the LATER list. `null` for a hero slot means the live feed carries
// no departure there — the renderer dashes it. `later` is the departures after
// THEN within the 60-min horizon (up to LATER_COUNT); empty when none follow, in
// which case the renderer dashes the section. (Cancelled / NO SERVICE is a later
// slice; here a missing slot is just an empty hero.)
export type ServiceColumn = {
  mode: Mode;
  serviceId: string; // NEXT departure's service id, e.g. "1"; falls back to the target's first id when empty
  tripHeadsign: string; // NEXT departure's destination headsign; '' when unknown
  next: DepartureSlot | null; // soonest upcoming departure
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
      };
}

// Serialises one LATER row to its snake_case wire shape.
function laterJson(row: LaterRow): Record<string, unknown> {
  return { leave_in: row.leaveIn, arrives: row.arrives };
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
