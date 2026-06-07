// Data contract for the priority_split layout: the format-agnostic ViewModel
// that service.ts builds (phase 1) and view.tsx renders (phase 2) — the
// rendered strings for the column header, Tiers 1–3, and the marker ratio.
// Deliberately logic-free — DTOs plus their JSON projection — so this file
// answers only "what shape does this layout draw?"; every derivation (the
// PRD §5.3 + glossary §3/§5/§6 maths) lives in service.ts.

import type { Mode } from './mode-icon';

// A column carrying a catchable service — the full Tier 1–3 + marker layout.
// (Also the gateway-error/closed fallback, rendered with every field dashed:
// a transient fetch failure must read as "no data" blanks, not the deliberate
// NO SERVICE state, which only a genuinely empty live feed earns.)
export type ServiceColumn = {
	kind: 'service';
	mode: Mode;
	serviceId: string; // selected service's id, e.g. "634"
	tripHeadsign: string; // destination headsign, e.g. "Island Bay"; '' when unknown
	leaveIn: string; // "7 MIN" | "NOW"
	leaveBy: string; // "BY 07:08"
	arrives: string; // "ARRIVES IN 4 MIN · 07:14"
	next: string; // up to three services after the hero: "NEXT 14:48 → 14:58 → 15:40" | "NEXT 14:48" | "—"
	markerRatio: number; // 0 = hard-left, 1 = Now
};

// The no-service state (glossary §4): zero catchable services. The Tier 1 hero
// becomes the literal NO SERVICE; the only supporting line is the next departure
// clock when the live feed still carries an upcoming (if uncatchable) bus, else a
// dash. Track, marker, and Tiers 2/3 are suppressed — there is nothing to leave for.
export type NoServiceColumn = {
	kind: 'no_service';
	mode: Mode;
	serviceId: string; // target's first service id — the header still names the route
	tripHeadsign: ''; // unknown without a selected service
	nextDeparture: string; // "08:42" when one is known; '' when none — the renderer omits the line (a lone dash reads as a stray artifact)
};

export type ColumnViewModel = ServiceColumn | NoServiceColumn;

export type PrioritySplitViewModel = {
	wallClock: string; // global header — "07:30"
	date: string; // global header — "Sat 31 May" (confirms the frame is fresh, #46)
	columns: ColumnViewModel[]; // one per transit target; single → full width
};

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). A real projection, not the identity: maps the renderer's
// camelCase fields to their snake_case wire names; the values are exactly the
// strings/ratio Satori is fed, so the JSON view is a serialiser of the
// rendered type, never a parallel definition.
export function toJsonView(vm: PrioritySplitViewModel): Record<string, unknown> {
	return {
		wall_clock: vm.wallClock,
		date: vm.date,
		columns: vm.columns.map((c) =>
			c.kind === 'no_service'
				? {
						kind: c.kind,
						mode: c.mode,
						service_id: c.serviceId,
						trip_headsign: c.tripHeadsign,
						next_departure: c.nextDeparture,
					}
				: {
						kind: c.kind,
						mode: c.mode,
						service_id: c.serviceId,
						trip_headsign: c.tripHeadsign,
						leave_in: c.leaveIn,
						leave_by: c.leaveBy,
						arrives: c.arrives,
						next: c.next,
						marker_ratio: c.markerRatio,
					},
		),
	};
}
