// Public two-phase entry for the priority_split layout (#72) and the home of
// its derivation. buildViewModel fetches each transit target's arrivals from
// the Metlink gateway (uncached by design — ADR-0010), maps any classified
// failure onto its problem type, and fills the data contract in viewmodel.ts:
// the wall-clock global header plus one column per transit target — the Tier
// 1–3 strings and the marker ratio, all maths per PRD §5.3 + glossary
// §3/§5/§6. render is the pure view-model → artefacts pipeline, producing
// only what the negotiated format needs (ADR-0004). PrioritySplitContext
// declares the slice of RenderContext this layout consumes — its dependency
// manifest; the radiator and every binding but METLINK_API_KEY are
// unreachable by construction.
//
// viewModelFromStopStates is a deliberate domain-granularity test seam: the
// column/marker behaviour is specified against gateway StopStates because
// driving those cases through layout.buildViewModel would mean feeding
// Metlink wire payloads to a stubbed fetch — dragging the wire format this
// folder must not know (ADR-0005 quarantine) into its tests. The layout's
// fetch + error-mapping path is still tested through the public surface.

import type { Layout, RenderContext } from '../registry';
import { fetchArrivals, type Arrival, type StopState } from '../../gateways/metlink/metlink';
import type { GatewayError } from '../../gateways/metlink/metlink';
import type { TransitTarget } from '../../config/types';
import {
	type AppError,
	metlinkAuth,
	metlinkBadRequest,
	metlinkRateLimited,
	metlinkUnavailable,
} from '../../shared/errors';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
import {
	toJsonView,
	type ColumnViewModel,
	type NoServiceColumn,
	type PrioritySplitViewModel,
	type ServiceColumn,
} from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

// The slice of RenderContext this layout actually consumes (registry Ctx
// parameter): the resolved phase (transit targets), the outbound fetch with
// its Metlink key and prediction limit, and the timezone/clock — no radiator
// fields, no other bindings.
export type PrioritySplitContext = Pick<
	RenderContext,
	'phase' | 'timezone' | 'stopPredictionLimit' | 'now' | 'format' | 'includeBmp' | 'fetchFn'
> & {
	env: Pick<Env, 'METLINK_API_KEY'>;
};

// Maps a classified gateway failure onto its problem type (ADR-0011). The
// gateway stays a typed-Result bulkhead (ADR-0005); this is where kind becomes
// policy and the error is thrown — a config fault (auth / bad id) backs off hard
// and logs `error`, a transient blip retries at the phase cadence and logs
// `warn`. Note a `closed:true` envelope is a *successful* fetch (the stop is
// shut), not an error — it never reaches here, so it still renders normally.
function toAppError(error: GatewayError, target: TransitTarget): AppError {
	switch (error.kind) {
		case 'auth':
			return metlinkAuth(error.status, error.detail);
		case 'client_error':
			return metlinkBadRequest(error.status, target.stopId, error.detail);
		case 'rate_limited':
			return metlinkRateLimited(error.detail);
		case 'upstream':
			return metlinkUnavailable(
				`Metlink is unavailable (HTTP ${error.status}). The radiator will retry on its next wake cycle.`,
				error.detail,
			);
		case 'network':
			return metlinkUnavailable(
				'Metlink is unreachable (network error). The radiator will retry on its next wake cycle.',
			);
	}
}

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
// layout.buildViewModel.
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

export const layout: Layout<PrioritySplitViewModel, PrioritySplitContext> = {
	version: LAYOUT_VERSION,
	async buildViewModel(ctx) {
		const targets = ctx.phase.transitTargets ?? [];

		// One gateway call per target. A failed fetch short-circuits the frame by
		// throwing the mapped problem type (#59) rather than silently degrading to a
		// closed stop — the renderFrame boundary turns the throw into a problem+json
		// response. A successful fetch (including a legitimate `closed`/empty-feed
		// stop) still flows through to the view model and renders a normal frame.
		const states: StopState[] = await Promise.all(
			targets.map(async (t) => {
				const result = await fetchArrivals({
					fetch: ctx.fetchFn,
					apiKey: ctx.env.METLINK_API_KEY,
					stopId: t.stopId,
					serviceId: t.serviceId,
					destinationStopId: t.destinationStopId,
					destinationNameIncludes: t.destinationNameIncludes,
					limit: ctx.stopPredictionLimit,
				});
				if (result.ok) return result.data;
				throw toAppError(result.error, t);
			}),
		);

		return viewModelFromStopStates(targets, states, ctx.timezone, ctx.now);
	},
	async render(vm, ctx) {
		const needsBmp = ctx.format === 'bmp' || ctx.includeBmp;
		return {
			frame: needsBmp ? await renderBmp(vm) : null,
			svg: ctx.format === 'svg' ? await renderSvg(vm) : null,
		};
	},
	toJsonView,
};
