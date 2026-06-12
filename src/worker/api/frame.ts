// Orchestrator for GET /v1/frame. Validates the shared token, resolves the
// radiator slug → radiator and the active profile phase, asks the feature to
// prepare the frame (ADR-0017: cheap view + version up front, rendering
// deferred), and hands the result to shapeFrame (response.ts) for the
// negotiated format. Between prepare and render sits the conditional frame
// check (ADR-0013): on the image/bmp path a matching If-None-Match answers 304
// Not Modified without ever rendering. Auth, slug resolution, sleep duration,
// and the observability headers are identical across every format.

import { validate } from '../auth/validate';
import { GLOBAL, lookupRadiator } from '../config/lookup';
import type { Radiator } from '../config/lookup';
import { layouts } from '../features/registry';
import type { FrameDeps, FramePreparer } from '../features/registry';
import { resolveProfilePhase } from '../schedule/resolve';
import { log } from '../shared/log';
import {
	AppError,
	internalError,
	unauthorizedError,
	unknownRadiatorError,
} from '../shared/errors';
import { problemResponse } from './errors';
import { ifNoneMatchSatisfied, weakEtag } from './etag';
import { resolveResponseFormat } from './format';
import type { ResponseFormat } from './format';
import { frameNotModified, shapeFrame } from './response';
import type { FrameMeta } from './response';

// Maps a radiator slug to a fully-populated radiator, or undefined when the
// slug is unknown (fail closed → 404). handleFrame injects the production
// lookupRadiator; handleTestFrame (test-frame.ts) injects resolveTestRadiator.
export type RadiatorResolver = (slug: string) => Radiator | undefined;

// Production frame handler: the GET /v1/frame entry point for real radiator
// slugs. Just renderFrame with the production resolver injected.
export function handleFrame(
	request: Request,
	env: Env,
	now: Date,
): Promise<Response> {
	return renderFrame(request, env, now, lookupRadiator);
}

// Branch-free frame core. Authenticates, resolves the slug via the injected
// resolver, renders the active profile phase, and shapes the response for the
// negotiated format. Knows nothing about test- slugs or any other
// resolver-specific concern — auth and response shaping live here once, and
// every caller (handleFrame, handleTestFrame) flows through them.
export async function renderFrame(
	request: Request,
	env: Env,
	now: Date,
	resolve: RadiatorResolver,
): Promise<Response> {
	const req = parseFrameRequest(request);

	// Observability context (GH #25), assembled once and spread into every log
	// event: hardwareId (the firmware-sent MAC) and the optional client-supplied
	// requestId give per-device / cross-system correlation; batteryMv (GH #78)
	// is the per-wake battery telemetry. Undefined values are dropped by
	// JSON.stringify, so they need no conditional spread. Timing is owned by CF
	// trace spans (observability.traces), not logged here — workerd freezes
	// Date.now() between I/O so an in-script delta misleads (#54).
	const obs = {
		batteryMv: req.batteryMv,
		hardwareId: req.hardwareId,
		requestId: req.requestId,
		slug: req.slug,
	};

	// The active phase cadence and key, captured once resolved so the failure
	// boundary can derive a Retryable sleep and the X-Profile-Phase header. They
	// stay undefined / 'none' for any error thrown before phase resolution.
	let phaseCadence: number | undefined;
	let resolvedPhase = 'none';

	try {
		// 1. Request — authenticate & resolve the radiator
		const auth = validate(request.headers, env.RADIATOR_SHARED_TOKEN);
		if (!auth.ok) {
			log.warn('frame.unauthorized', obs);
			return problemResponse(unauthorizedError(), { requestId: req.requestId });
		}

		const radiator = resolve(req.slug);
		if (!radiator) {
			log.warn('frame.unknown_radiator', obs);
			return problemResponse(unknownRadiatorError(req.slug), { requestId: req.requestId });
		}

		// 2. Endpoint — resolve the phase, then prepare the frame. The feature
		// returns the cheap view + version up front and defers rendering, so the
		// orchestrator can answer the conditional check before any rasterisation
		// (ADR-0013).
		// WARN: tuple is getting long, actual some sort of TypeScript unpacking of Request in tuple 
		const { profilePhase, phase, layout, sleepSeconds } = resolveProfilePhase(radiator, now); 
		phaseCadence = sleepSeconds;
		resolvedPhase = profilePhase;

		// The per-request dependency bundle (ADR-0017 §6) — the registry binders
		// build each feature's own request from it.
		const deps: FrameDeps = {
			radiator,
			phase,
			timezone: GLOBAL.timezone,
			stopPredictionLimit: GLOBAL.stopPredictionLimit,
			now,
			format: req.format,
			includeBmp: req.includeBmp,
			env,
			// Bind to globalThis: workerd's `fetch` throws "Illegal invocation" if
			// invoked with a `this` other than the global scope, which happens once
			// it is passed around and called as a method (e.g. `req.fetch(...)` in
			// the Metlink client). Tests inject a plain mock fn so never hit this.
			fetchFn: fetch.bind(globalThis),
		};

		const prepare: FramePreparer = layouts[layout];
		const prepared = await prepare(deps);

		// The weak ETag is derived here (api/etag.ts) from the feature's view +
		// version, so generation can never drift from validation (ADR-0017 §7).
		const meta: FrameMeta = {
			sleepSeconds,
			serverTime: now,
			profilePhase,
			etag: weakEtag(prepared.view, prepared.version),
		};

		if (isUnchangedFrame(req, meta.etag)) {
			log.info('frame.completed', {
				...obs,
				layoutKey: layout,
				profilePhase,
				format: req.format,
				notModified: true,
			});
			return frameNotModified(meta);
		}

		// 3. Response — render the deferred artefacts and shape the negotiated
		// format from the same view the ETag was derived from.
		const rendered = await prepared.render();
		const response = await shapeFrame({
			format: req.format,
			layout,
			view: prepared.view,
			rendered,
			acceptsGzip: req.acceptsGzip,
			meta,
		});

		// Single completion log covering the full critical path (auth → render →
		// encode). Timing lives in the trace span, not a logged field (#54).
		log.info('frame.completed', { ...obs, layoutKey: layout, profilePhase, format: req.format });
		return response;
	} catch (err) {
		return failureResponse(err, {
			obs,
			requestId: req.requestId,
			phaseCadence,
			profilePhase: resolvedPhase,
		});
	}
}

// Everything renderFrame needs from the raw Request, parsed once: the radiator
// identity + telemetry headers and the negotiated response shape. includeBmp
// is meaningful only on the JSON diagnostics path (`?include_bmp=1` — lets the
// common JSON case skip the Satori/resvg pipeline entirely); ifNoneMatch is
// the conditional-request validator (ADR-0013).
type FrameRequest = {
	slug: string;
	hardwareId: string | undefined;
	requestId: string | undefined;
	batteryMv: number | undefined;
	format: ResponseFormat;
	includeBmp: boolean;
	acceptsGzip: boolean;
	ifNoneMatch: string | null;
};

function parseFrameRequest(request: Request): FrameRequest {
	const format = resolveResponseFormat(request.headers.get('Accept'));
	return {
		slug: request.headers.get('X-Radiator-Slug') ?? '',
		hardwareId: request.headers.get('X-Radiator-Hardware-Id') ?? undefined,
		requestId: request.headers.get('X-Request-Id') ?? undefined,
		batteryMv: parseBatteryMv(request.headers.get('X-Radiator-Battery-Mv')),
		format,
		includeBmp:
			format === 'json' &&
			new URL(request.url).searchParams.get('include_bmp') === '1',
		acceptsGzip: (request.headers.get('Accept-Encoding') ?? '').includes('gzip'),
		ifNoneMatch: request.headers.get('If-None-Match'),
	};
}

// Conditional frame request (ADR-0013 / #73): only the image/bmp path
// participates — a human on the JSON/SVG diagnostics surface came to see the
// data, so those always answer 200. The check sits after prepare (the answer to
// "did the content change?" is in its view + version) and before the deferred
// render, so a matching validator skips the entire Satori → resvg → BMP
// pipeline. Error paths never reach here: a prepare throw hits the failure
// boundary regardless of any If-None-Match.
function isUnchangedFrame(req: FrameRequest, etag: string): boolean {
	return req.format === 'bmp' && ifNoneMatchSatisfied(req.ifNoneMatch, etag);
}

// Failure boundary (ADR-0011). Maps any throw to a problem type — known
// AppErrors pass through, anything else becomes `internal` — then logs it and
// returns the problem+json response. No re-throw: the contract owns the
// status, sleep, and body, so CF never sees a bare 500. phaseCadence /
// profilePhase carry whatever the try block resolved before the throw, so a
// Retryable error can sleep at the phase cadence and name the phase.
function failureResponse(
	err: unknown,
	init: {
		obs: Record<string, unknown>;
		requestId: string | undefined;
		phaseCadence: number | undefined;
		profilePhase: string;
	},
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

	return problemResponse(error, {
		phaseCadence: init.phaseCadence,
		requestId: init.requestId,
		profilePhase: init.profilePhase,
	});
}

// Battery telemetry (GH #78): X-Radiator-Battery-Mv carries the radiator's raw
// battery voltage in millivolts. Parsed to a number so CF Workers Logs can
// range-query it (e.g. batteryMv < 3500); anything absent, non-integer, or
// negative becomes undefined — the field is silently dropped from the log line,
// never a request rejection, per the X-Radiator-* reserved-namespace rule.
function parseBatteryMv(raw: string | null): number | undefined {
	if (raw === null || raw.trim() === '') return undefined;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 0 ? n : undefined;
}
