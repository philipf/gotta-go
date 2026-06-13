// Orchestrator for GET /v1/frame: validates auth, resolves slug → active phase, prepares
// the frame, and routes to response shaping or a 304 for unchanged content.

import type { Radiator } from '../config/lookup';
import { GLOBAL, lookupRadiator } from '../config/lookup';
import type { ProfilePhaseResolution } from '../config/resolve';
import { resolveProfilePhase } from '../config/resolve';
import type { FrameDeps, FramePreparer } from '../features/frame-registry';
import { framePreparers } from '../features/frame-registry';
import { unauthorizedError, unknownRadiatorError } from '../shared/errors';
import { log } from '../shared/log';
import { auth } from './auth';
import { problemResponse } from './errors';
import { ifNoneMatchSatisfied, weakEtag } from './etag';
import { failureResponse } from './failure';
import type { FrameRequest } from './frame-request';
import { extractObservabilityInfo, parseFrameRequest } from './frame-request';
import type { FrameMeta } from './response';
import { frameNotModifiedResponse, shapeFrame } from './response';

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

	// The resolved phase, captured once so the failure boundary can derive a
	// Retryable sleep and the X-Profile-Phase header. Stays undefined for any
	// error thrown before phase resolution.
	let resolution: ProfilePhaseResolution | undefined;

	try {
		// 1. Request — authenticate & resolve the radiator
		const authResult = auth(request.headers, env.RADIATOR_SHARED_TOKEN);
		if (!authResult.ok) {
			log.warn('frame.unauthorized', extractObservabilityInfo(req));
			return problemResponse(unauthorizedError(), { requestId: req.requestId });
		}

		const radiator = resolve(req.slug);
		if (!radiator) {
			log.warn('frame.unknown_radiator', extractObservabilityInfo(req));
			return problemResponse(unknownRadiatorError(req.slug), { requestId: req.requestId });
		}

		// 2. Endpoint — resolve the phase, then prepare the frame. The feature
		// returns the cheap view + version up front and defers rendering, so the
		// orchestrator can answer the conditional check before any rasterisation
		// (ADR-0013).
		resolution = resolveProfilePhase(radiator, now);

		// The per-request dependency bundle (architecture guide) — the registry binders
		// build each feature's own request from it.
		const deps: FrameDeps = {
			radiator,
			phase: resolution.phase,
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

		const prepare: FramePreparer = framePreparers[resolution.layout];
		const prepared = await prepare(deps);

		// The weak ETag is derived here (api/etag.ts) from the feature's view +
		// version, so generation can never drift from validation (architecture guide).
		const meta: FrameMeta = {
			sleepSeconds: resolution.sleepSeconds,
			serverTime: now,
			profilePhase: resolution.profilePhase,
			etag: weakEtag(prepared.view, prepared.version),
		};

		if (isUnchangedFrame(req, meta.etag)) {
			log.info('frame.completed', {
				...extractObservabilityInfo(req),
				layoutKey: resolution.layout,
				profilePhase: resolution.profilePhase,
				format: req.format,
				notModified: true,
			});
			return frameNotModifiedResponse(meta);
		}

		// 3. Response — render the deferred artefacts and shape the negotiated
		// format from the same view the ETag was derived from.
		const rendered = await prepared.render();
		const response = await shapeFrame({
			format: req.format,
			layout: resolution.layout,
			view: prepared.view,
			rendered,
			acceptsGzip: req.acceptsGzip,
			meta,
		});

		// Single completion log covering the full critical path (auth → render →
		// encode). Timing lives in the trace span, not a logged field (#54).
		log.info('frame.completed', {
			...extractObservabilityInfo(req),
			layoutKey: resolution.layout,
			profilePhase: resolution.profilePhase,
			format: req.format,
		});
		return response;
	} catch (err) {
		return failureResponse(err, {
			obs: extractObservabilityInfo(req),
			requestId: req.requestId,
			activePhaseSleepSeconds: resolution?.sleepSeconds,
			profilePhase: resolution?.profilePhase ?? 'none',
		});
	}
}

// Maps a radiator slug to a fully-populated radiator, or undefined when the
// slug is unknown (fail closed → 404). handleFrame injects the production
// lookupRadiator; handleTestFrame (test-frame.ts) injects resolveTestRadiator.
export type RadiatorResolver = (slug: string) => Radiator | undefined;

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
