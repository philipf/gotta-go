// Public two-phase entry for the minimal_clock layout (#72). buildViewModel
// derives the view model from the RenderContext — no external fetch — and
// render produces only the rendered artefact the negotiated format needs
// (ADR-0004): the rasterised BMP, the intermediate Satori SVG, or neither.
// Ignores the transit-only context fields (env, fetch, phase).

import type { Layout } from '../registry';
import { buildViewModel, toJsonView, type ViewModel } from './viewmodel';
import { renderBmp, renderSvg } from './view';

export const layout: Layout<ViewModel> = {
	async buildViewModel(ctx) {
		return buildViewModel(ctx.radiator, ctx.timezone, ctx.now);
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
