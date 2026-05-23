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
