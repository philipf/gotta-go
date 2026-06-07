// Public two-phase entry for the dual_month_calendar layout (#72/#75).
// buildViewModel derives the view model from the RenderContext — pure date
// math plus a public-holidays KV read (#84) whose failure degrades to an
// unshaded calendar, never an error frame (soft-miss; see the gateway header)
// — and render produces only the rendered artefact the negotiated format
// needs (ADR-0004): the rasterised BMP, the intermediate Satori SVG, or
// neither. Ignores the transit-only context fields (fetch, phase).

import type { Layout } from '../registry';
import { fetchHolidays } from '../../gateways/public_holidays/public-holidays';
import { buildViewModel, toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

export const layout: Layout<ViewModel> = {
	version: LAYOUT_VERSION,
	async buildViewModel(ctx) {
		const holidays = await fetchHolidays({ kv: ctx.env.PUBLIC_HOLIDAYS });
		return buildViewModel(ctx.radiator, ctx.timezone, ctx.now, holidays);
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
