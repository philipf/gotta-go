// Failure boundary for the frame pipeline: maps any throw to a typed problem+json response
// without re-throwing — the Worker never surfaces a bare 500.

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
