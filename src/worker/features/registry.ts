// Layout registry. Maps layout keys (minimal_clock, priority_split, …) to
// their render() entry points and exports LayoutKey as the source of truth
// used by config/types.ts, so phase config and the registry can never drift.
//
// Renderers receive a single RenderContext so the orchestrator owns every
// binding (env, fetch, the resolved phase) per ADR-0005 §DI — no renderer
// reads a global. minimal_clock ignores the transit-only fields.

import type { Radiator } from '../config/lookup';
import type { ProfilePhase } from '../config/types';
import type { ResponseFormat } from '../api/format';
import { render as minimalClockRender } from './minimal_clock/service';
import { render as prioritySplitRender } from './priority_split/service';
import { render as idleJokesRender } from './idle_jokes/service';

export type RenderContext = {
	radiator: Radiator;
	phase: ProfilePhase;
	timezone: string;
	// Upper bound for the Metlink /stop-predictions `limit` (GLOBAL.stopPredictionLimit).
	// Threaded through the context rather than read from a global so renderers stay
	// binding-driven per ADR-0005 §DI. minimal_clock ignores it.
	stopPredictionLimit: number;
	now: Date;
	format: ResponseFormat;
	// Whether the rasterised BMP is needed: always for `format: 'bmp'`, and for
	// `format: 'json'` only when `?include_bmp=1` was requested. Lets the JSON
	// path skip the Satori/resvg pipeline entirely for the common case.
	includeBmp: boolean;
	env: Env;
	fetchFn: typeof fetch;
};

// Every renderer returns its format-agnostic view model (the structured input
// Satori receives, ready to serialise for the JSON variant — ADR-0004) plus the
// optional rendered artefacts: the rasterised BMP and the intermediate Satori
// SVG, each produced only when the negotiated format needs it. `frame` is null
// on the JSON path that opted out of the BMP; `svg` is null unless the SVG
// variant (#20) was negotiated.
export type RenderResult = {
	frame: Uint8Array | null;
	svg: string | null;
	viewModel: Record<string, unknown>;
};

export const layouts = {
	minimal_clock: minimalClockRender,
	priority_split: prioritySplitRender,
	idle_jokes: idleJokesRender,
} satisfies Record<string, (ctx: RenderContext) => Promise<RenderResult>>;

export type LayoutKey = keyof typeof layouts;
