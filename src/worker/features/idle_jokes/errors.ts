// Error policy for the idle_jokes feature (ADR-0011/ADR-0017 §4): the gateway
// reports failure as data, this file turns that outcome into the one idle
// problem type and the gateway-error → AppError mapping. prepare throws it; the
// renderFrame boundary shapes the problem+json.

// FIX: The shared/ folder contains feature/gateway specific errors. We need to guard that shared/ doesn't become the dumping ground
// AppError might be ok, but I think jokeSourceUnavailable is too specific and should declared as an error in the feature folder
// NOTE: resolved — jokeSourceUnavailable now lives here. The 'joke-source-unavailable'
// slug stays in shared's ProblemSlug union by decision (ADR-0017 §4: the union is
// the compiler-checked mirror of the error catalog); that one line is the feature's
// named deletion residue. The shared/ admission rule itself is a separate ADR.

import { type AppError, RetryableError } from '../../shared/errors';
import type { JokeGatewayError } from '../../gateways/icanhazdadjoke/fetch-joke';

// idle_jokes content source (icanhazdadjoke) unreachable / 5xx / unusable body.
// Treated exactly like Metlink (#17): a 502, Retryable, warn — so an overnight
// joke-API blip retries on the next idle wake at the idle phase cadence rather
// than wedging. No bundled fallback by design; the firmware shows the error
// screen per ADR-0011.
export function jokeSourceUnavailable(detail: string, upstreamDetail?: string): RetryableError {
	return new RetryableError({
		slug: 'joke-source-unavailable',
		title: 'Idle content unavailable',
		status: 502,
		detail,
		upstreamDetail,
	});
}

// Maps a classified gateway failure onto the one idle problem type (ADR-0011).
// Both kinds are Retryable 502s — an overnight blip retries on the next idle
// wake at the idle phase cadence; the HTTP case carries the upstream snippet.
export function toAppError(error: JokeGatewayError): AppError {
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
