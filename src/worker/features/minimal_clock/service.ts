// Public two-phase entry for the minimal_clock layout (#72) and the home of
// its derivation. buildViewModel derives the data contract in viewmodel.ts —
// slug + 24-hour HH:MM wall-clock time + "Dow DD Mon" date in the supplied
// timezone, no external fetch — and render produces only the rendered
// artefact the negotiated format needs (ADR-0004): the rasterised BMP, the
// intermediate Satori SVG, or neither. ClockContext declares the slice of
// RenderContext this layout consumes — its dependency manifest; env, fetchFn,
// phase, and stopPredictionLimit are unreachable by construction.

import type { Layout, RenderContext } from '../registry';
import type { Radiator } from '../../config/lookup';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
import { toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

// The slice of RenderContext this layout actually consumes (registry Ctx
// parameter): slug is the only radiator field read; no bindings, no fetch.
export type ClockContext = Pick<RenderContext, 'timezone' | 'now' | 'format' | 'includeBmp'> & {
	radiator: Pick<Radiator, 'slug'>;
};

export const layout: Layout<ViewModel, ClockContext> = {
	version: LAYOUT_VERSION,
	async buildViewModel(ctx) {
		return {
			slug: ctx.radiator.slug,
			time: hhmm(ctx.now, ctx.timezone),
			date: shortDate(ctx.now, ctx.timezone),
		};
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
