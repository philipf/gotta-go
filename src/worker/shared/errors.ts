// App-wide exception hierarchy for RFC 9457 problem+json: carries type slug, title, status,
// detail, sleep policy, and log level — everything the failure boundary needs.

// Every `type` URL dereferences to an anchor in docs/api/errors.md (ADR-0011).
export const ERRORS_DOC_BASE = 'https://github.com/philipf/gotta-go/blob/main/docs/api/errors.md';

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
  | 'joke-source-unavailable'
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

  // Sleep duration (whole seconds) for this error's class. `phaseSleepSeconds` is
  // the resolved profile phase's sleep duration, or undefined when the error
  // preceded phase resolution. Returning undefined omits `X-Sleep-Seconds` so the
  // firmware's 300s fallback applies (ADR-0011).
  abstract sleepSeconds(phaseSleepSeconds: number | undefined): number | undefined;
}

// Transient: the next wake may succeed. Sleeps at the resolved phase's sleep
// duration (undefined before phase resolution → no header). Logs at `warn` by default.
export class RetryableError extends AppError {
  constructor(init: AppErrorInit) {
    super(init, 'warn');
  }

  sleepSeconds(phaseSleepSeconds: number | undefined): number | undefined {
    return phaseSleepSeconds;
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
    detail: 'The Authorization bearer token was missing or did not match the configured shared token.',
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
