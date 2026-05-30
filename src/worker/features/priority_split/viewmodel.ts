// Pure view-model construction for the priority_split layout. Turns a transit
// target + the gateway's domain StopState into the rendered strings for the
// column header, Tiers 1–3, and the marker ratio. No I/O, no globals — the
// async fetch lives in service.ts. All maths follow PRD §5.3 + glossary §3/§5/§6.

import type { TransitTarget } from '../../config/types';
import type { Arrival, StopState } from '../../gateways/metlink/metlink';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
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
	next: string; // "NEXT 07:22" | "—"
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

const MS_PER_MIN = 60_000;
const DASH = '—';

function minutesUntil(target: Date, now: Date): number {
	return (target.getTime() - now.getTime()) / MS_PER_MIN;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

// leave_by_time = arrival_time − time_to_stop_mins (glossary §3).
function leaveByTime(a: Arrival, target: TransitTarget): Date {
	return new Date(a.predicted.getTime() - target.timeToStopMins * MS_PER_MIN);
}

// The catchable service is the earliest arrival you can still make — its
// leave_by_time has not yet passed (glossary §4). Past ones are missed.
function selectCatchable(arrivals: Arrival[], target: TransitTarget, now: Date): Arrival[] {
	return [...arrivals]
		.sort((a, b) => a.predicted.getTime() - b.predicted.getTime())
		.filter((a) => leaveByTime(a, target).getTime() >= now.getTime());
}

function fallbackRouteId(target: TransitTarget): string {
	return Array.isArray(target.serviceId) ? target.serviceId[0] : target.serviceId;
}

// Gateway error / closed stop: degrade to dashes rather than throw. Distinct
// from the no-service state — a failed fetch must not masquerade as a confident
// "NO SERVICE" when the truth is "we couldn't ask".
function degraded(target: TransitTarget): ServiceColumn {
	return {
		kind: 'service',
		mode: target.mode,
		serviceId: fallbackRouteId(target),
		tripHeadsign: '', // no catchable service — destination unknown
		leaveIn: DASH,
		leaveBy: DASH,
		arrives: DASH,
		next: DASH,
		markerRatio: 1,
	};
}

// The no-service column (glossary §4 / #10). `nextDeparture` is the earliest
// arrival still in the future for this target — it is, by definition, not
// catchable (or it would have been selected), but it tells the rider when the
// next bus physically departs. Empty when the live feed carries none, so the
// renderer shows NO SERVICE alone rather than a meaningless dash beneath it.
function noService(
	target: TransitTarget,
	arrivals: Arrival[],
	tz: string,
	now: Date,
): NoServiceColumn {
	const upcoming = [...arrivals]
		.filter((a) => a.predicted.getTime() >= now.getTime())
		.sort((a, b) => a.predicted.getTime() - b.predicted.getTime());
	return {
		kind: 'no_service',
		mode: target.mode,
		serviceId: fallbackRouteId(target),
		tripHeadsign: '',
		nextDeparture: upcoming[0] ? hhmm(upcoming[0].predicted, tz) : '',
	};
}

// Assembles the full layout view model: the wall-clock global header plus one
// column per transit target (states aligned by index with targets). A single
// target yields one column, which the renderer auto-scales to full frame width.
export function buildViewModel(
	targets: TransitTarget[],
	states: StopState[],
	tz: string,
	now: Date,
): PrioritySplitViewModel {
	return {
		wallClock: hhmm(now, tz),
		date: shortDate(now, tz),
		columns: targets.map((target, i) => buildColumn(target, states[i], tz, now)),
	};
}

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). Maps the renderer's camelCase fields to their snake_case wire
// names; the values are exactly the strings/ratio Satori is fed, so the JSON
// view is a serialiser of the rendered type, never a parallel definition.
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

export function buildColumn(
	target: TransitTarget,
	state: StopState,
	tz: string,
	now: Date,
): ColumnViewModel {
	// Closed stop / gateway error: dashes, kept distinct from no-service (above).
	if (state.kind === 'closed') return degraded(target);

	const catchable = selectCatchable(state.arrivals, target, now);
	const service = catchable[0];

	// Open stop, but nothing catchable: the deliberate NO SERVICE state (#10),
	// not the confusing all-dashes column it used to render (#36).
	if (!service) return noService(target, state.arrivals, tz, now);

	const leaveBy = leaveByTime(service, target);
	const leaveInMins = Math.max(
		0,
		Math.round(minutesUntil(service.predicted, now) - target.timeToStopMins),
	);
	const arrivesInMins = Math.max(0, Math.round(minutesUntil(service.predicted, now)));

	// Marker: position_ratio = 1 − clamp(leave_margin / window, 0, 1) (PRD §5.3).
	const leaveMargin = Math.max(0, minutesUntil(leaveBy, now));
	const window = target.timeToStopMins * target.comfortBuffer;
	const markerRatio = 1 - clamp(leaveMargin / window, 0, 1);

	const nextService = catchable[1];

	return {
		kind: 'service',
		mode: target.mode,
		serviceId: service.serviceId,
		tripHeadsign: service.tripHeadsign,
		leaveIn: leaveInMins === 0 ? 'NOW' : `${leaveInMins} MIN`,
		leaveBy: `BY ${hhmm(leaveBy, tz)}`,
		arrives: `ARRIVES IN ${arrivesInMins} MIN · ${hhmm(service.predicted, tz)}`,
		next: nextService ? `NEXT ${hhmm(nextService.predicted, tz)}` : DASH,
		markerRatio,
	};
}
