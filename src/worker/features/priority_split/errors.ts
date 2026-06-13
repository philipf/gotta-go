// Error policy for the priority_split feature (ADR-0011; architecture guide): the
// Metlink gateway reports failure as data (ok:false unions, architecture guide); this
// file turns each kind into policy — a config fault (auth / bad id) backs off
// hard and logs `error`, a transient blip retries at the active phase's sleep duration and logs
// `warn` — and prepare throws it. The metlink-* slugs stay in shared's
// ProblemSlug union (architecture guide: the compiler-checked mirror of the error
// catalog) — the feature's named residue.

import { type AppError, FatalError, RetryableError } from '../../shared/errors';
import type { MetlinkGatewayError } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';

// Metlink 401/403 — a bad/expired METLINK_API_KEY. Ours (500), Fatal, error.
export function metlinkAuth(upstreamStatus: number, upstreamDetail?: string): FatalError {
	return new FatalError({
		slug: 'metlink-auth',
		title: 'Transit data unavailable',
		status: 500,
		detail: `Metlink rejected the configured API key (HTTP ${upstreamStatus}). Check METLINK_API_KEY.`,
		upstreamDetail,
	});
}

// Metlink 4xx other than 429 — a bad stop/service id in config. Ours (500),
// Fatal, error.
export function metlinkBadRequest(
	upstreamStatus: number,
	stopId: string,
	upstreamDetail?: string,
): FatalError {
	return new FatalError({
		slug: 'metlink-bad-request',
		title: 'Transit target misconfigured',
		status: 500,
		detail: `Metlink returned HTTP ${upstreamStatus} for stop ${stopId} — check the transit target stop id in config.yaml.`,
		upstreamDetail,
	});
}

// Metlink 5xx / network failure / timeout / unusable body. Upstream's (502),
// Retryable, warn. `detail` describes the specific cause.
export function metlinkUnavailable(detail: string, upstreamDetail?: string): RetryableError {
	return new RetryableError({
		slug: 'metlink-unavailable',
		title: 'Transit data unavailable',
		status: 502,
		detail,
		upstreamDetail,
	});
}

// Metlink 429 — we exceeded its rate limit. Upstream's (502), Retryable, warn.
export function metlinkRateLimited(upstreamDetail?: string): RetryableError {
	return new RetryableError({
		slug: 'metlink-rate-limited',
		title: 'Transit data unavailable',
		status: 502,
		detail: 'Metlink returned HTTP 429 (rate limited). The radiator will retry on its next wake cycle.',
		upstreamDetail,
	});
}

// Maps a classified gateway failure onto its problem type (ADR-0011). The
// gateway stays a typed-Result bulkhead (ADR-0005); this is where kind becomes
// policy and the error is thrown. Note a `closed:true` envelope is a
// *successful* fetch (the stop is shut), not an error — it never reaches here,
// so it still renders normally.
export function toAppError(error: MetlinkGatewayError, target: TransitTarget): AppError {
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
