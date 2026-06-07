// Public two-phase entry for the idle_jokes layout — the idle profile's
// ambient content (#17) — and the home of its derivation. buildViewModel
// fetches a random dad joke from the icanhazdadjoke gateway, maps any failure,
// and fills the data contract in viewmodel.ts: the joke text, its upstream id
// (diagnostics), and a font size stepped by length so a short one-liner fills
// the column and a long joke still fits and stays legible in the 70% text
// pane. No wall-clock/date — the idle profile sleeps up to 4h, so any rendered
// time would be stale (#17 grill). render is the pure view-model → artefacts
// pipeline, producing only what the negotiated format needs (ADR-0004).
// JokesContext declares the slice of RenderContext this layout consumes — its
// dependency manifest; the radiator, env, and the transit-only fields are
// unreachable by construction.
//
// A failed fetch short-circuits by throwing jokeSourceUnavailable — treated
// exactly like a Metlink failure (ADR-0011): the renderFrame boundary turns the
// throw into a 502 problem+json and the firmware shows the error screen. No
// bundled fallback by design (#17 grill).

import type { Layout, RenderContext } from '../registry';
import { fetchJoke, type GatewayError } from '../../gateways/icanhazdadjoke/icanhazdadjoke';
import { type AppError, jokeSourceUnavailable } from '../../shared/errors';
import { toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

// The slice of RenderContext this layout actually consumes (registry Ctx
// parameter): the outbound fetch and the negotiated format — no radiator
// fields, no bindings.
export type JokesContext = Pick<RenderContext, 'fetchFn' | 'format' | 'includeBmp'>;

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

// Length buckets (characters) → px. Tuned for the ~620px-wide joke column at
// 540px tall; verify live per ADR-0009. Three steps keep short jokes deliberate
// and long ones from overflowing.
const SHORT = 70;
const MEDIUM = 130;
const FONT_LARGE = 51;
const FONT_MEDIUM = 38;
const FONT_SMALL = 29;

function fontSizeFor(text: string): number {
	if (text.length <= SHORT) return FONT_LARGE;
	if (text.length <= MEDIUM) return FONT_MEDIUM;
	return FONT_SMALL;
}

export const layout: Layout<ViewModel, JokesContext> = {
	version: LAYOUT_VERSION,
	async buildViewModel(ctx) {
		const result = await fetchJoke({ fetch: ctx.fetchFn });
		if (!result.ok) throw toAppError(result.error);
		return {
			text: result.data.text,
			id: result.data.id,
			fontSize: fontSizeFor(result.data.text),
		};
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
