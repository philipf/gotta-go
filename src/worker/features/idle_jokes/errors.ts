// Error policy for idle_jokes: maps gateway outcomes to a joke-source-unavailable AppError.

import { type AppError, RetryableError } from '../../shared/errors';
import type { JokeGatewayError } from '../../gateways/icanhazdadjoke/fetch-joke';

// idle_jokes content source (icanhazdadjoke) unreachable / 5xx / unusable body.
// Treated exactly like Metlink (#17): a 502, Retryable, warn — so an overnight
// joke-API blip retries on the next idle wake at the idle phase's sleep duration
// rather than wedging. No bundled fallback by design; the firmware shows the error
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
// wake at the idle phase's sleep duration; the HTTP case carries the upstream snippet.
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
