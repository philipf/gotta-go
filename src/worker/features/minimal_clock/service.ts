// Public render entry for the minimal_clock layout. Builds the view model from
// the RenderContext, then produces only the rendered artefact the negotiated
// format needs (ADR-0004): the rasterised BMP, the intermediate Satori SVG, or
// neither — alongside the always-serialisable view model so the orchestrator
// can shape the image, the SVG, or the JSON envelope. Ignores the transit-only
// context fields (env, fetch, phase).

import type { RenderContext, RenderResult } from '../registry';
import { buildViewModel, toJsonView } from './viewmodel';
import { renderBmp, renderSvg } from './view';

export async function render(ctx: RenderContext): Promise<RenderResult> {
	const vm = buildViewModel(ctx.radiator, ctx.timezone, ctx.now);
	const needsBmp = ctx.format === 'bmp' || ctx.includeBmp;
	return {
		frame: needsBmp ? await renderBmp(vm) : null,
		svg: ctx.format === 'svg' ? await renderSvg(vm) : null,
		viewModel: toJsonView(vm),
	};
}
