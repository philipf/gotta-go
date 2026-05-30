// Pure view-model construction for the priority_split layout. Turns a transit
// target + the gateway's domain StopState into the rendered strings for the
// column header, Tiers 1–3, and the marker ratio. No I/O, no globals — the
// async fetch lives in service.ts. All maths follow PRD §5.3 + glossary §3/§5/§6.

import type { TransitTarget } from '../../config/types';
import type { Arrival, StopState } from '../../gateways/metlink/metlink';
import type { Mode } from './mode-icon';

export type ColumnViewModel = {
	mode: Mode;
	routeCode: string; // selected service's id, e.g. "634"
	leaveIn: string; // "7 MIN" | "NOW"
	leaveBy: string; // "BY 07:08"
	arrives: string; // "ARRIVES 4 MIN · 07:14"
	next: string; // "NEXT 07:22" | "—"
	markerRatio: number; // 0 = hard-left, 1 = Now
};

export type PrioritySplitViewModel = {
	wallClock: string; // global header — "07:30"
	columns: ColumnViewModel[]; // one per transit target; single → full width
};

const MS_PER_MIN = 60_000;
const DASH = '—';

// Cached 24-hour HH:MM formatter per timezone (same pattern as
// minimal_clock/viewmodel and schedule/resolve).
const HHMM = new Map<string, Intl.DateTimeFormat>();
function hhmm(d: Date, tz: string): string {
	let fmt = HHMM.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		HHMM.set(tz, fmt);
	}
	return fmt.format(d);
}

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

function degraded(target: TransitTarget): ColumnViewModel {
	const fallbackRoute = Array.isArray(target.serviceId)
		? target.serviceId[0]
		: target.serviceId;
	return {
		mode: target.mode,
		routeCode: fallbackRoute,
		leaveIn: DASH,
		leaveBy: DASH,
		arrives: DASH,
		next: DASH,
		markerRatio: 1,
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
		columns: vm.columns.map((c) => ({
			mode: c.mode,
			route_code: c.routeCode,
			leave_in: c.leaveIn,
			leave_by: c.leaveBy,
			arrives: c.arrives,
			next: c.next,
			marker_ratio: c.markerRatio,
		})),
	};
}

export function buildColumn(
	target: TransitTarget,
	state: StopState,
	tz: string,
	now: Date,
): ColumnViewModel {
	const catchable =
		state.kind === 'open' ? selectCatchable(state.arrivals, target, now) : [];
	const service = catchable[0];

	// No catchable service — no-service rendering is deferred (#5 out of scope).
	// Degrade gracefully rather than throw.
	if (!service) return degraded(target);

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
		mode: target.mode,
		routeCode: service.serviceId,
		leaveIn: leaveInMins === 0 ? 'NOW' : `${leaveInMins} MIN`,
		leaveBy: `BY ${hhmm(leaveBy, tz)}`,
		arrives: `ARRIVES ${arrivesInMins} MIN · ${hhmm(service.predicted, tz)}`,
		next: nextService ? `NEXT ${hhmm(nextService.predicted, tz)}` : DASH,
		markerRatio,
	};
}
