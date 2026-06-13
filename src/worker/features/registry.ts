// Composition root for the feature tier (ADR-0017 §6). Maps each layout key to
// a FramePreparer binder, and exports LayoutKey as the source of truth used by
// config/types.ts so phase config and the registry can never drift. Each binder
// receives the per-request FrameDeps bundle the orchestrator assembles once
// (ADR-0005 §DI), binds gateway capabilities to transport, and collapses format
// negotiation into the feature's own request — the one place that legitimately
// sees every feature's dependencies. The sin this prevents is a feature
// importing FrameDeps; features declare their own response types and the
// `satisfies` check below proves compatibility structurally at the wiring site.

import type { Radiator } from '../config/lookup';
import type { ProfilePhase } from '../config/types';
import type { ResponseFormat } from '../api/format';
import { prepareJokeFrame } from './idle_jokes/prepare-joke-frame';
import { fetchJoke } from '../gateways/icanhazdadjoke/fetch-joke';
import { preparePrioritySplitFrame } from './priority_split/prepare-priority-split-frame';
import { fetchArrivals } from '../gateways/metlink/fetch-arrivals';
import { prepareDualMonthCalendarFrame } from './dual_month_calendar/prepare-dual-month-calendar-frame';
import { fetchHolidays } from '../gateways/public_holidays/fetch-holidays';
import { prepareMinimalClockFrame } from './minimal_clock/prepare-minimal-clock-frame';

// The per-request dependency bundle every binder receives. It is the union of
// every feature's needs — acceptable here and only here (ADR-0017 §6): the
// composition root is the one place that legitimately sees everything.
export type FrameDeps = {
	radiator: Radiator;
	phase: ProfilePhase;
	timezone: string;
	// Upper bound for the Metlink /stop-predictions `limit` (GLOBAL.stopPredictionLimit).
	// Threaded through the bundle rather than read from a global so features stay
	// binding-driven per ADR-0005 §DI. Transit-only: priority_split is the sole
	// consumer.
	stopPredictionLimit: number;
	now: Date;
	format: ResponseFormat;
	// Whether the rasterised BMP is needed: always for `format: 'bmp'`, and for
	// `format: 'json'` only when `?include_bmp=1` was requested. Lets the JSON
	// path skip the Satori/resvg pipeline entirely for the common case.
	includeBmp: boolean;
	// The full Env is ambient authority — every binding reachable by every
	// feature. Features narrow it where they bind (Pick<Env, …>).
	env: Env;
	fetchFn: typeof fetch;
};

// The optional rendered artefacts a prepared frame's render() produces: the
// rasterised BMP and the intermediate Satori SVG, each non-null only when the
// negotiated format needs it.
export type RenderResult = {
	frame: Uint8Array | null;
	svg: string | null;
};

// What the orchestrator needs from every feature (ADR-0017 §6): the cheap JSON
// view and appearance version (both ETag inputs) up front, and a deferred
// render closure for the expensive artefacts — so a 304 returns without ever
// rasterising (ADR-0013). Features declare structurally-compatible response
// types of their own and import nothing from here.
export type PreparedFrame = {
	view: Record<string, unknown>;
	version: number;
	render: () => Promise<RenderResult>;
};

export type FramePreparer = (deps: FrameDeps) => Promise<PreparedFrame>;

export const layouts = {
	minimal_clock: (deps) =>
		prepareMinimalClockFrame({
			slug: deps.radiator.slug,
			timezone: deps.timezone,
			now: deps.now,
			includeBmp: deps.format === 'bmp' || deps.includeBmp,
			includeSvg: deps.format === 'svg',
		}),
	priority_split: (deps) =>
		preparePrioritySplitFrame({
			targets: deps.phase.transitTargets ?? [],
			fetchArrivals: (target) =>
				fetchArrivals({
					fetch: deps.fetchFn,
					apiKey: deps.env.METLINK_API_KEY,
					stopId: target.stopId,
					serviceId: target.serviceId,
					destinationStopId: target.destinationStopId,
					destinationNameIncludes: target.destinationNameIncludes,
					limit: deps.stopPredictionLimit,
				}),
			timezone: deps.timezone,
			now: deps.now,
			includeBmp: deps.format === 'bmp' || deps.includeBmp,
			includeSvg: deps.format === 'svg',
		}),
	idle_jokes: (deps) =>
		prepareJokeFrame({
			fetchJoke: () => fetchJoke({ fetch: deps.fetchFn }),
			includeBmp: deps.format === 'bmp' || deps.includeBmp,
			includeSvg: deps.format === 'svg',
		}),
	dual_month_calendar: (deps) =>
		prepareDualMonthCalendarFrame({
			fetchHolidays: () => fetchHolidays({ kv: deps.env.PUBLIC_HOLIDAYS }),
			slug: deps.radiator.slug,
			timezone: deps.timezone,
			now: deps.now,
			includeBmp: deps.format === 'bmp' || deps.includeBmp,
			includeSvg: deps.format === 'svg',
		}),
} satisfies Record<string, FramePreparer>;

export type LayoutKey = keyof typeof layouts;
