// App-wide exception hierarchy for the RFC 9457 problem+json error contract
// (ADR-0011). An AppError carries everything the boundary needs to shape a
// problem document — the `type` slug, `title`, `status`, per-occurrence
// `detail`, and an optional raw `upstreamDetail` snippet — plus two behavioural
// dimensions the boundary reads off the subclass: the sleep policy (Fatal backs
// off hard, Retryable inherits the phase cadence) and the log level. Anything in
// the Worker can throw one; renderFrame catches the hierarchy and returns the
// matching problem+json response (api/errors.ts shapes the wire body).

// Every `type` URL dereferences to an anchor in docs/api/errors.md (ADR-0011).
export const ERRORS_DOC_BASE =
	'https://github.com/philipf/gotta-go/blob/main/docs/api/errors.md';

// Upper bound on a raw upstream snippet, shared by the structured-log field and
// the wire `upstream_detail` member (ADR-0011) so a log line and a problem
// document never disagree about how much upstream context survived (#55).
export const MAX_SNIPPET = 2048;

// Truncates a raw upstream body to MAX_SNIPPET; undefined for an empty/absent
// body so the field drops out of both the log and the problem document.
export function snippet(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return text.length > MAX_SNIPPET ? text.slice(0, MAX_SNIPPET) : text;
}

// The catalogued problem-type slugs (ADR-0011). The `not-found` router case is
// shaped directly in api/errors.ts (no class, no sleep) and so is absent here.
export type ProblemSlug =
	| 'metlink-auth'
	| 'metlink-bad-request'
	| 'metlink-unavailable'
	| 'metlink-rate-limited'
	| 'internal'
	| 'unauthorized'
	| 'unknown-radiator';

type AppErrorInit = {
	slug: ProblemSlug;
	title: string;
	status: number;
	detail: string;
	upstreamDetail?: string;
	// Overrides the subclass default. `internal` is Retryable yet logs at
	// `error`; `unauthorized`/`unknown-radiator` are Fatal yet log at `warn`.
	logLevel?: 'warn' | 'error';
};

export abstract class AppError extends Error {
	readonly slug: ProblemSlug;
	readonly title: string;
	readonly status: number;
	readonly detail: string;
	readonly upstreamDetail?: string;
	readonly logLevel: 'warn' | 'error';

	protected constructor(init: AppErrorInit, defaultLogLevel: 'warn' | 'error') {
		super(init.detail);
		this.name = new.target.name;
		this.slug = init.slug;
		this.title = init.title;
		this.status = init.status;
		this.detail = init.detail;
		this.upstreamDetail = snippet(init.upstreamDetail);
		this.logLevel = init.logLevel ?? defaultLogLevel;
	}

	get type(): string {
		return `${ERRORS_DOC_BASE}#${this.slug}`;
	}

	// Sleep duration (whole seconds) for this error's class. `phaseCadence` is the
	// active profile-phase cadence, or undefined when the error preceded phase
	// resolution. Returning undefined omits `X-Sleep-Seconds` so the firmware's
	// 300s fallback applies (ADR-0011).
	abstract sleepSeconds(phaseCadence: number | undefined): number | undefined;
}

// Transient: the next wake may succeed. Sleeps at the resolved phase cadence
// (undefined before phase resolution → no header). Logs at `warn` by default.
export class RetryableError extends AppError {
	constructor(init: AppErrorInit) {
		super(init, 'warn');
	}

	sleepSeconds(phaseCadence: number | undefined): number | undefined {
		return phaseCadence;
	}
}

// A human must act. Backs off hard (3600s) regardless of phase, so a tight
// retry loop against a misconfiguration is not pure noise. Logs at `error` by
// default.
export class FatalError extends AppError {
	constructor(init: AppErrorInit) {
		super(init, 'error');
	}

	sleepSeconds(): number {
		return 3600;
	}
}

// -----------------------------------------------------------------------
// Problem-type catalog (ADR-0011 / docs/api/errors.md). One factory per slug so
// the title/status/class live in exactly one place; callers supply only the
// per-occurrence prose and any upstream snippet.
// -----------------------------------------------------------------------

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

// Any unhandled thrown error. Retryable (most throws are transient) but logged
// at `error` because an unexpected throw warrants a human's eyes (ADR-0011).
export function internalError(): RetryableError {
	return new RetryableError({
		slug: 'internal',
		title: 'Unexpected error',
		status: 500,
		detail: 'An unexpected error occurred while rendering the frame.',
		logLevel: 'error',
	});
}

// Missing/wrong shared token. 401, Fatal (3600s), but logs at `warn` — routine
// on a misconfigured re-flash and not actionable server-side.
export function unauthorizedError(): FatalError {
	return new FatalError({
		slug: 'unauthorized',
		title: 'Radiator not authorised',
		status: 401,
		detail: 'The X-Radiator-Token header was missing or did not match the configured shared token.',
		logLevel: 'warn',
	});
}

// Radiator slug not in config. 404, Fatal (3600s), logs at `warn`.
export function unknownRadiatorError(slug: string): FatalError {
	return new FatalError({
		slug: 'unknown-radiator',
		title: 'Radiator not recognised',
		status: 404,
		detail: `No radiator is configured for slug '${slug}'.`,
		logLevel: 'warn',
	});
}
