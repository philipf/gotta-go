// Public render entry for the priority_split layout. Fetches each transit
// target's arrivals from the Metlink gateway (uncached for now — #24 wraps the
// same public entry with KV transparently), builds the view model, then
// produces only the rendered artefact the negotiated format needs (ADR-0004) —
// the rasterised BMP, the intermediate Satori SVG, or neither — and returns it
// alongside the serialisable view model for the JSON envelope.

import type { RenderContext, RenderResult } from '../registry';
import { fetchArrivals, type StopState } from '../../gateways/metlink/metlink';
import { log } from '../../shared/log';
import { buildViewModel, toJsonView } from './viewmodel';
import { renderBmp, renderSvg } from './view';

export async function render(ctx: RenderContext): Promise<RenderResult> {
	const targets = ctx.phase.transitTargets ?? [];

	// One gateway call per target. A failed fetch still degrades to a closed stop
	// so the column renders dashes rather than throwing (the failure-policy
	// redesign is deferred to #56) — but the failure is no longer silent (#55).
	// auth = a broken/expired API key (a config error a human must fix) → error;
	// transient kinds (network/rate_limited/upstream) → warn.
	const states: StopState[] = await Promise.all(
		targets.map(async (t) => {
			const result = await fetchArrivals({
				fetch: ctx.fetchFn,
				apiKey: ctx.env.METLINK_API_KEY,
				stopId: t.stopId,
				serviceId: t.serviceId,
				limit: ctx.stopPredictionLimit,
			});
			if (result.ok) return result.data;

			const { error } = result;
			const fields = {
				kind: error.kind,
				status: error.kind === 'upstream' ? error.status : undefined,
				detail: error.kind === 'upstream' ? error.detail : undefined,
				stopId: t.stopId,
				serviceId: t.serviceId,
				radiatorSlug: ctx.radiator.slug,
			};
			if (error.kind === 'auth') log.error('metlink.fetch_failed', fields);
			else log.warn('metlink.fetch_failed', fields);
			return { kind: 'closed' };
		}),
	);

	const vm = buildViewModel(targets, states, ctx.timezone, ctx.now);
	const needsBmp = ctx.format === 'bmp' || ctx.includeBmp;
	return {
		frame: needsBmp ? await renderBmp(vm) : null,
		svg: ctx.format === 'svg' ? await renderSvg(vm) : null,
		viewModel: toJsonView(vm),
	};
}
