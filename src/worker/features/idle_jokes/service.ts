// Public render entry for the idle_jokes layout — the idle profile's ambient
// content (#17). Fetches a random dad joke from the icanhazdadjoke gateway,
// builds the view model, then produces only the rendered artefact the negotiated
// format needs (ADR-0004): the rasterised BMP, the intermediate Satori SVG, or
// neither — alongside the serialisable view model for the JSON envelope. Ignores
// the transit-only context fields (phase, stopPredictionLimit).
//
// A failed fetch short-circuits by throwing jokeSourceUnavailable — treated
// exactly like a Metlink failure (ADR-0011): the renderFrame boundary turns the
// throw into a 502 problem+json and the firmware shows the error screen. No
// bundled fallback by design (#17 grill).

import type { RenderContext, RenderResult } from '../registry';
import { fetchJoke, type GatewayError } from '../../gateways/icanhazdadjoke/icanhazdadjoke';
import { type AppError, jokeSourceUnavailable } from '../../shared/errors';
import { buildViewModel, toJsonView } from './viewmodel';
import { renderBmp, renderSvg } from './view';

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

export async function render(ctx: RenderContext): Promise<RenderResult> {
	const result = await fetchJoke({ fetch: ctx.fetchFn });
	if (!result.ok) throw toAppError(result.error);

	const vm = buildViewModel(result.data);
	const needsBmp = ctx.format === 'bmp' || ctx.includeBmp;
	return {
		frame: needsBmp ? await renderBmp(vm) : null,
		svg: ctx.format === 'svg' ? await renderSvg(vm) : null,
		viewModel: toJsonView(vm),
	};
}
