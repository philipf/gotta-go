// Failure boundary (ADR-0011) for the frame pipeline. Maps any throw to a
// problem type — known AppErrors pass through, anything else becomes `internal`
// — then logs it and shapes the problem+json response. No re-throw: the contract
// owns the status, sleep, and body, so CF never sees a bare 500. This is the
// throw→response seam; the problem+json shaping it delegates to lives in
// errors.ts (problemResponse).

import { AppError, internalError } from '../shared/errors';
import { log } from '../shared/log';
import { problemResponse } from './errors';
import type { FrameRequestContext } from './errors';

// The FrameRequestContext fields carry whatever the orchestrator resolved before
// the throw, so a Retryable error can sleep at the active phase's sleep duration
// and name the phase; `obs` is the observability context (frame-request.ts)
// folded into the log line.
export function failureResponse(
	err: unknown,
	init: FrameRequestContext & { obs: Record<string, unknown> },
): Response {
	const error = err instanceof AppError ? err : internalError();
	const fields: Record<string, unknown> = {
		...init.obs,
		problemType: error.slug,
		status: error.status,
		detail: error.detail,
		upstreamDetail: error.upstreamDetail,
	};
	// An unknown (non-AppError) throw also carries the raw stack for triage.
	if (!(err instanceof AppError)) {
		fields.error =
			err instanceof Error
				? { name: err.name, message: err.message, stack: err.stack }
				: { message: String(err) };
	}
	if (error.logLevel === 'error') log.error('frame.error', fields);
	else log.warn('frame.error', fields);

	return problemResponse(error, init);
}
