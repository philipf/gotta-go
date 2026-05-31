// Problem+json response shaper (ADR-0011). Turns an AppError (shared/errors.ts)
// into an RFC 9457 `application/problem+json` response, and shapes the one
// class-less error — the router's `not-found` — directly. `X-Sleep-Seconds`
// rides as a header (derived from the error's class), never a body member; the
// firmware reads it exactly as it read the old plain-text responses.

import { ERRORS_DOC_BASE, type AppError } from '../shared/errors';

const PROBLEM_JSON = 'application/problem+json';

export type ProblemResponseInit = {
	// Active profile-phase cadence (seconds), or undefined when the error
	// preceded phase resolution. Retryable errors inherit it; Fatal ignore it.
	phaseCadence?: number;
	// Inbound X-Request-Id → the problem `instance` URN. Omitted when absent.
	requestId?: string;
	// Resolved profile phase for X-Profile-Phase; 'none' before resolution.
	profilePhase?: string;
};

export function problemResponse(error: AppError, init: ProblemResponseInit = {}): Response {
	const body: Record<string, unknown> = {
		type: error.type,
		title: error.title,
		status: error.status,
		detail: error.detail,
	};
	if (init.requestId) body.instance = `urn:gotta-go:request:${init.requestId}`;
	if (error.upstreamDetail !== undefined) body.upstream_detail = error.upstreamDetail;

	const headers: Record<string, string> = {
		'Content-Type': PROBLEM_JSON,
		'X-Profile-Phase': init.profilePhase ?? 'none',
	};
	const sleep = error.sleepSeconds(init.phaseCadence);
	if (sleep !== undefined) headers['X-Sleep-Seconds'] = String(sleep);

	return new Response(JSON.stringify(body), { status: error.status, headers });
}

// Router-level 404 for an unknown path — a developer/curl condition a radiator
// never hits. Carried in the same problem+json envelope for one error shape
// everywhere (ADR-0011), but class-less: no `X-Sleep-Seconds` (the firmware's
// 300s fallback covers the theoretical case), no profile phase.
export function notFound(method: string, path: string): Response {
	const body = {
		type: `${ERRORS_DOC_BASE}#not-found`,
		title: 'Not found',
		status: 404,
		detail: `No route matches ${method} ${path}.`,
	};
	return new Response(JSON.stringify(body), {
		status: 404,
		headers: { 'Content-Type': PROBLEM_JSON },
	});
}
