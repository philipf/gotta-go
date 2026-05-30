// Public render entry for the priority_split layout. Fetches each transit
// target's arrivals from the Metlink gateway (uncached for now — #24 wraps the
// same public entry with KV transparently), builds the view model, then
// rasterises the BMP only when the negotiated format needs it (ADR-0004) and
// returns it alongside the serialisable view model for the JSON envelope.

import type { RenderContext, RenderResult } from '../registry';
import { fetchArrivals, type StopState } from '../../gateways/metlink/metlink';
import { buildViewModel, toJsonView } from './viewmodel';
import { renderBmp } from './bmp';

export async function render(ctx: RenderContext): Promise<RenderResult> {
	const targets = ctx.phase.transitTargets ?? [];

	// One gateway call per target. A failed fetch degrades to a closed stop so
	// the column renders dashes rather than throwing (full no-service / error
	// rendering is deferred — see the plan's out-of-scope list).
	const states: StopState[] = await Promise.all(
		targets.map(async (t) => {
			const result = await fetchArrivals({
				fetch: ctx.fetchFn,
				apiKey: ctx.env.METLINK_API_KEY,
				stopId: t.stopId,
				serviceId: t.serviceId,
			});
			return result.ok ? result.data : { kind: 'closed' };
		}),
	);

	const vm = buildViewModel(targets, states, ctx.timezone, ctx.now);
	const needsBmp = ctx.format === 'bmp' || ctx.includeBmp;
	return {
		frame: needsBmp ? await renderBmp(vm) : null,
		viewModel: toJsonView(vm),
	};
}
