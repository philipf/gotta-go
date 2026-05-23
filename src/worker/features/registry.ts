// Layout registry. Maps layout keys (minimal_clock, …) to their render()
// entry points and exports LayoutKey as the source of truth used by
// config/types.ts, so phase config and the registry can never drift.

import type { Radiator } from '../config/lookup';
import type { ResponseFormat } from '../api/format';
import { render as minimalClockRender } from './minimal_clock/service';

export const layouts = {
	minimal_clock: minimalClockRender,
} satisfies Record<
	string,
	(
		radiator: Radiator,
		timezone: string,
		now: Date,
		format: ResponseFormat,
	) => Promise<Uint8Array>
>;

export type LayoutKey = keyof typeof layouts;
