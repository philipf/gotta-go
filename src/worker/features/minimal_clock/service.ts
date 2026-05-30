// Public render entry for the minimal_clock layout. Builds the view model from
// the RenderContext, rasterises the BMP only when the negotiated format needs
// it (ADR-0004), and returns both the BMP and the serialisable view model so
// the orchestrator can shape either the image or the JSON envelope. Ignores the
// transit-only context fields (env, fetch, phase).

import type { RenderContext, RenderResult } from '../registry';
import { buildViewModel, toJsonView } from './viewmodel';
import { renderBmp } from './bmp';

export async function render(ctx: RenderContext): Promise<RenderResult> {
	const vm = buildViewModel(ctx.radiator, ctx.timezone, ctx.now);
	const needsBmp = ctx.format === 'bmp' || ctx.includeBmp;
	return {
		frame: needsBmp ? await renderBmp(vm) : null,
		viewModel: toJsonView(vm),
	};
}
