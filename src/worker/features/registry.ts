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

export type RenderContext = {
	radiator: Radiator;
	phase: ProfilePhase;
	timezone: string;
	now: Date;
	format: ResponseFormat;
	env: Env;
	fetchFn: typeof fetch;
};

export const layouts = {
	minimal_clock: minimalClockRender,
	priority_split: prioritySplitRender,
} satisfies Record<string, (ctx: RenderContext) => Promise<Uint8Array>>;

export type LayoutKey = keyof typeof layouts;
