// Layout registry. Maps layout keys (minimal_clock, priority_split, …) to
// their Layout entry points and exports LayoutKey as the source of truth
// used by config/types.ts, so phase config and the registry can never drift.
//
// Every layout is two-phase (#72): buildViewModel(ctx) owns any external fetch
// and its error mapping and returns the format-agnostic view model; render(vm,
// ctx) is the pure Satori → resvg → BMP pipeline (and the SVG diagnostics
// variant) from that view model. The split lets the orchestrator hold the view
// model *before* deciding to render — the foundation for the ETag/304 skip
// (ADR-0013) and for render-free JSON/SVG diagnostics paths.
//
// Layouts receive a single RenderContext so the orchestrator owns every
// binding (env, fetch, the resolved phase) per ADR-0005 §DI — no layout
// reads a global. minimal_clock ignores the transit-only fields.

import type { Radiator } from '../config/lookup';
import type { ProfilePhase } from '../config/types';
import type { ResponseFormat } from '../api/format';
import { layout as minimalClockLayout } from './minimal_clock/service';
import { layout as prioritySplitLayout } from './priority_split/service';
import { layout as idleJokesLayout } from './idle_jokes/service';
import { layout as dualMonthCalendarLayout } from './dual_month_calendar/service';

export type RenderContext = {
	radiator: Radiator;
	phase: ProfilePhase;
	timezone: string;
	// Upper bound for the Metlink /stop-predictions `limit` (GLOBAL.stopPredictionLimit).
	// Threaded through the context rather than read from a global so layouts stay
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

// The optional rendered artefacts render(vm, ctx) produces: the rasterised BMP
// and the intermediate Satori SVG, each produced only when the negotiated
// format needs it. `frame` is null on the JSON path that opted out of the BMP;
// `svg` is null unless the SVG variant (#20) was negotiated. The view model
// itself lives outside the result — the orchestrator builds it first and
// projects it via toJsonView(vm) for the JSON envelope (ADR-0004).
export type RenderResult = {
	frame: Uint8Array | null;
	svg: string | null;
};

// The two-phase contract every layout implements. Declared with method syntax
// so each layout's concretely-typed entry (Layout<its ViewModel>) remains
// assignable to the orchestrator-facing Layout<unknown> — the orchestrator
// treats the view model as an opaque token passed between the phases.
export type Layout<VM = unknown> = {
	// Phase 1: owns any external fetch and its error mapping (Metlink for
	// priority_split, the joke source for idle_jokes, none for minimal_clock)
	// and returns the format-agnostic view model (the structured input Satori
	// receives, ready to serialise for the JSON variant — ADR-0004).
	buildViewModel(ctx: RenderContext): Promise<VM>;
	// Phase 2: pure view model → artefacts. No fetch, no error mapping.
	render(vm: VM, ctx: RenderContext): Promise<RenderResult>;
	// Projects the view model for the JSON diagnostics envelope (ADR-0004).
	toJsonView(vm: VM): Record<string, unknown>;
	// The layout's LAYOUT_VERSION (declared in its view.tsx, beside the
	// appearance it versions). Folded into the weak ETag (ADR-0013) so a
	// visual-only change — same view model, different pixels — busts every
	// radiator's cached validator. Forgetting the bump is the review failure
	// mode: a deployed visual change that never appears on matching panels.
	version: number;
};

export const layouts = {
	minimal_clock: minimalClockLayout,
	priority_split: prioritySplitLayout,
	idle_jokes: idleJokesLayout,
	dual_month_calendar: dualMonthCalendarLayout,
} satisfies Record<string, Layout>;

export type LayoutKey = keyof typeof layouts;
