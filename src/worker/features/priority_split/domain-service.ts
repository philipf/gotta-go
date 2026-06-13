// Domain service for priority_split: turns already-fetched gateway StopStates
// into the format-agnostic view model — the wall-clock global header plus one
// column per transit target, the Tier 1–3 strings and the marker ratio (PRD
// §5.3 + glossary §3/§5/§6).
//
// viewModelFromStopStates is a deliberate domain-granularity test seam: the
// column/marker behaviour is specified against gateway StopStates because
// driving those cases through the public capability would mean feeding Metlink
// wire payloads to a stubbed fetch — dragging the wire format this folder must
// not know (ADR-0005 quarantine) into its tests. The fetch + error-mapping path
// is still tested through the public capability.

import type { Arrival, StopState } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
import type {
	ColumnViewModel,
	NoServiceColumn,
	PrioritySplitViewModel,
	ServiceColumn,
} from './viewmodel';

const MS_PER_MIN = 60_000;
const DASH = '—';

// Tier 3 shows up to this many services *after* the hero (catchable[1..3]) —
// the hero itself is catchable[0]. Hardcoded by design: the SPLIT-pane width
// (view.tsx) caps how many times fit on one line, so a config knob that can't
// safely grow past 3 would be illusory. Promote to config only on real need.
const NEXT_COUNT = 3;

// Separator between the Tier 3 service times: "NEXT 14:48 → 14:58 → 15:40".
// U+2192 is present in the full bundled DejaVu Sans Bold (ADR-0009); its thin
// shaft is the most at-risk glyph on the 1-bit panel, so this is provisional
// pending the live read — swap to '›' here if it thresholds ragged.
const SEP = ' → ';

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

function buildColumn(
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

	// The next NEXT_COUNT services after the hero — all catchable by definition
	// (later than the selected one). Renders only those that exist, no dash
	// padding: a trailing "→ —" would read as missing data, not "no more buses".
	const upcoming = catchable.slice(1, 1 + NEXT_COUNT);

	return {
		kind: 'service',
		mode: target.mode,
		serviceId: service.serviceId,
		tripHeadsign: service.tripHeadsign,
		leaveIn: leaveInMins === 0 ? 'NOW' : `${leaveInMins} MIN`,
		leaveBy: `BY ${hhmm(leaveBy, tz)}`,
		arrives: `ARRIVES IN ${arrivesInMins} MIN · ${hhmm(service.predicted, tz)}`,
		next: upcoming.length
			? `NEXT ${upcoming.map((a) => hhmm(a.predicted, tz)).join(SEP)}`
			: DASH,
		markerRatio,
	};
}

// Assembles the full layout view model from already-fetched gateway states:
// the wall-clock global header plus one column per transit target (states
// aligned by index with targets). A single target yields one column, which the
// renderer auto-scales to full frame width. Exported as the domain-granularity
// test seam (see the header comment); production code reaches it only through
// the prepare capability.
export function viewModelFromStopStates(
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
