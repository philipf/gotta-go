// Public render entry for the priority_split layout. Fetches each transit
// target's arrivals from the Metlink gateway (uncached for now — #24 wraps the
// same public entry with KV transparently), builds the view model, then
// dispatches by ResponseFormat.

import type { RenderContext } from '../registry';
import type { ResponseFormat } from '../../api/format';
import { fetchArrivals, type StopState } from '../../gateways/metlink/metlink';
import { buildViewModel, type PrioritySplitViewModel } from './viewmodel';
import { renderBmp } from './bmp';

const renderers: Record<ResponseFormat, (vm: PrioritySplitViewModel) => Promise<Uint8Array>> = {
	bmp: renderBmp,
};

export async function render(ctx: RenderContext): Promise<Uint8Array> {
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
	return renderers[ctx.format](vm);
}
