// Public two-phase entry for the idle_jokes layout — the idle profile's ambient
// content (#17). buildViewModel fetches a random dad joke from the
// icanhazdadjoke gateway and maps any failure; render is the pure view-model →
// artefacts pipeline, producing only what the negotiated format needs
// (ADR-0004): the rasterised BMP, the intermediate Satori SVG, or neither.
// Ignores the transit-only context fields (phase, stopPredictionLimit).
//
// A failed fetch short-circuits by throwing jokeSourceUnavailable — treated
// exactly like a Metlink failure (ADR-0011): the renderFrame boundary turns the
// throw into a 502 problem+json and the firmware shows the error screen. No
// bundled fallback by design (#17 grill).

import type { Layout } from '../registry';
import { fetchJoke, type GatewayError } from '../../gateways/icanhazdadjoke/icanhazdadjoke';
import { type AppError, jokeSourceUnavailable } from '../../shared/errors';
import { buildViewModel, toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

// Maps a classified gateway failure onto the one idle problem type (ADR-0011).
// Both kinds are Retryable 502s — an overnight blip retries on the next idle
// wake at the idle phase cadence; the HTTP case carries the upstream snippet.
function toAppError(error: GatewayError): AppError {
	switch (error.kind) {
		case 'upstream':
			return jokeSourceUnavailable(
				`The joke source returned HTTP ${error.status}. The radiator will retry on its next wake cycle.`,
				error.detail,
			);
		case 'network':
			return jokeSourceUnavailable(
				'The joke source is unreachable (network error). The radiator will retry on its next wake cycle.',
			);
	}
}

export const layout: Layout<ViewModel> = {
	version: LAYOUT_VERSION,
	async buildViewModel(ctx) {
		const result = await fetchJoke({ fetch: ctx.fetchFn });
		if (!result.ok) throw toAppError(result.error);
		return buildViewModel(result.data);
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
