// Problem+json response shaper: turns an AppError into an RFC 9457 application/problem+json
// response; X-Sleep-Seconds is a header derived from the error class, never a body member.

import { ERRORS_DOC_BASE, type AppError } from '../shared/errors';

const PROBLEM_JSON = 'application/problem+json';

// The subset of the resolved request that a problem response needs but the
// AppError class does not carry — everything here is per-request, not per-error.
// Each field is optional because errors thrown earlier in the pipeline (auth,
// unknown radiator) haven't resolved the phase yet.
export type FrameRequestContext = {
  // The active profile phase's sleep duration (seconds), or undefined when the
  // error preceded phase resolution. Retryable errors inherit it; Fatal ignore it.
  activePhaseSleepSeconds?: number;
  // Inbound X-Request-Id → the problem `instance` URN. Omitted when absent.
  requestId?: string;
  // Resolved profile phase for X-Profile-Phase; 'none' before resolution.
  profilePhase?: string;
};

export function problemResponse(error: AppError, init: FrameRequestContext = {}): Response {
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
  const sleep = error.sleepSeconds(init.activePhaseSleepSeconds);
  if (sleep !== undefined) headers['X-Sleep-Seconds'] = String(sleep);

  return new Response(JSON.stringify(body), { status: error.status, headers });
}

// Router-level 404 for an unknown path — a developer/curl condition a radiator
// never hits. Carried in the same problem+json envelope for one error shape
// everywhere (ADR-0011), but class-less: no `X-Sleep-Seconds` (the firmware's
// 300s fallback covers the theoretical case), no profile phase.
export function notFoundResponse(method: string, path: string): Response {
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
