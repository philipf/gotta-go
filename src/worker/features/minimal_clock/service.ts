// Public render entry for the minimal_clock layout. Builds the view model
// from the RenderContext then dispatches by ResponseFormat to the matching
// renderer. Ignores the transit-only context fields (env, fetch, phase).

import type { RenderContext } from '../registry';
import type { ResponseFormat } from '../../api/format';
import { buildViewModel, type ViewModel } from './viewmodel';
import { renderBmp } from './bmp';

// Indexed by ResponseFormat so adding a new format to the union surfaces a
// TypeScript error here until a renderer is supplied.
const renderers: Record<ResponseFormat, (vm: ViewModel) => Promise<Uint8Array>> = {
	bmp: renderBmp,
};

export async function render(ctx: RenderContext): Promise<Uint8Array> {
	const vm = buildViewModel(ctx.radiator, ctx.timezone, ctx.now);
	return renderers[ctx.format](vm);
}
