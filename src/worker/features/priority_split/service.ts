// Public render entry for the priority_split layout. Fetches each transit
// target's arrivals from the Metlink gateway (uncached for now — #24 wraps the
// same public entry with KV transparently), builds the view model, then
// produces only the rendered artefact the negotiated format needs (ADR-0004) —
// the rasterised BMP, the intermediate Satori SVG, or neither — and returns it
// alongside the serialisable view model for the JSON envelope.

import type { RenderContext, RenderResult } from '../registry';
import { fetchArrivals, type StopState } from '../../gateways/metlink/metlink';
import type { GatewayError } from '../../gateways/metlink/metlink';
import type { TransitTarget } from '../../config/types';
import {
	type AppError,
	metlinkAuth,
	metlinkBadRequest,
	metlinkRateLimited,
	metlinkUnavailable,
} from '../../shared/errors';
import { buildViewModel, toJsonView } from './viewmodel';
import { renderBmp, renderSvg } from './view';

// Maps a classified gateway failure onto its problem type (ADR-0011). The
// gateway stays a typed-Result bulkhead (ADR-0005); this is where kind becomes
// policy and the error is thrown — a config fault (auth / bad id) backs off hard
// and logs `error`, a transient blip retries at the phase cadence and logs
// `warn`. Note a `closed:true` envelope is a *successful* fetch (the stop is
// shut), not an error — it never reaches here, so it still renders normally.
function toAppError(error: GatewayError, target: TransitTarget): AppError {
	switch (error.kind) {
		case 'auth':
			return metlinkAuth(error.status, error.detail);
		case 'client_error':
			return metlinkBadRequest(error.status, target.stopId, error.detail);
		case 'rate_limited':
			return metlinkRateLimited(error.detail);
		case 'upstream':
			return metlinkUnavailable(
				`Metlink is unavailable (HTTP ${error.status}). The radiator will retry on its next wake cycle.`,
				error.detail,
			);
		case 'network':
			return metlinkUnavailable(
				'Metlink is unreachable (network error). The radiator will retry on its next wake cycle.',
			);
	}
}

export async function render(ctx: RenderContext): Promise<RenderResult> {
	const targets = ctx.phase.transitTargets ?? [];

	// One gateway call per target. A failed fetch now short-circuits the render by
	// throwing the mapped problem type (#59) rather than silently degrading to a
	// closed stop — the renderFrame boundary turns the throw into a problem+json
	// response. A successful fetch (including a legitimate `closed`/empty-feed
	// stop) still flows through to the view model and renders a normal frame.
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
			throw toAppError(result.error, t);
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
