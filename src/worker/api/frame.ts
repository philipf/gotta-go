// Orchestrator for GET /v1/frame. Validates the shared token, resolves the
// radiator slug → radiator and the active profile phase, dispatches to the
// layout's renderer, then shapes the response for the negotiated format: a
// gzipped BMP for the radiator (ADR-0003), or — on the diagnostics path
// (ADR-0004) — a JSON view-model envelope or the intermediate Satori SVG. Auth,
// slug resolution, sleep duration, and the observability headers are identical
// across every format.

import { validate } from '../auth/validate';
import { GLOBAL, lookupRadiator } from '../config/lookup';
import type { Radiator } from '../config/lookup';
import { layouts } from '../features/registry';
import { resolveProfilePhase } from '../schedule/resolve';
import { gzip } from '../shared/gzip';
import { log } from '../shared/log';
import {
	AppError,
	internalError,
	unauthorizedError,
	unknownRadiatorError,
} from '../shared/errors';
import { buildFrameEnvelope } from './envelope';
import { problemResponse } from './errors';
import { resolveResponseFormat } from './format';
import { frameJson, frameOk, frameSvg } from './response';

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
	// Observability context (GH #25). hardwareId (the firmware-sent MAC) and the
	// optional client-supplied requestId give per-device / cross-system
	// correlation; CF's per-invocation grouping ties the rest together. Undefined
	// values are dropped by JSON.stringify, so they need no conditional spread.
	// Timing is owned by CF trace spans (observability.traces), not logged here —
	// workerd freezes Date.now() between I/O so an in-script delta misleads (#54).
	const slug = request.headers.get('X-Radiator-Slug') ?? '';
	const hardwareId = request.headers.get('X-Radiator-Hardware-Id') ?? undefined;
	const requestId = request.headers.get('X-Request-Id') ?? undefined;

	// The active phase cadence and key, captured once resolved so the failure
	// boundary can derive a Retryable sleep and the X-Profile-Phase header. They
	// stay undefined / 'none' for any error thrown before phase resolution.
	let phaseCadence: number | undefined;
	let resolvedPhase = 'none';

	try {
		// 1. Request — authenticate & parse
		const auth = validate(request.headers, env.RADIATOR_SHARED_TOKEN);
		if (!auth.ok) {
			log.warn('frame.unauthorized', { hardwareId, requestId, slug });
			return problemResponse(unauthorizedError(), { requestId });
		}

		const radiator = resolve(slug);
		if (!radiator) {
			log.warn('frame.unknown_radiator', { hardwareId, requestId, slug });
			return problemResponse(unknownRadiatorError(slug), { requestId });
		}

		const format = resolveResponseFormat(request.headers.get('Accept'));
		const includeBmp =
			format === 'json' &&
			new URL(request.url).searchParams.get('include_bmp') === '1';
		const acceptsGzip = (request.headers.get('Accept-Encoding') ?? '').includes(
			'gzip',
		);

		// 2. Endpoint — resolve domain inputs & render
		const { profilePhase, phase, layout, sleepSeconds } = resolveProfilePhase(radiator, now);
		phaseCadence = sleepSeconds;
		resolvedPhase = profilePhase;
		const rendered = await layouts[layout]({
			radiator,
			phase,
			timezone: GLOBAL.timezone,
			stopPredictionLimit: GLOBAL.stopPredictionLimit,
			now,
			format,
			includeBmp,
			env,
			// Bind to globalThis: workerd's `fetch` throws "Illegal invocation" if
			// invoked with a `this` other than the global scope, which happens once
			// it is passed around and called as a method (e.g. `req.fetch(...)` in
			// the Metlink client). Tests inject a plain mock fn so never hit this.
			fetchFn: fetch.bind(globalThis),
		});

		// 3. Response — encode & shape. The observability inputs are identical
		// across every format; only the body shape and Content-Type differ.
		let response: Response;
		if (format === 'json') {
			const envelope = buildFrameEnvelope({
				profilePhase,
				layout,
				serverTime: now,
				viewModel: rendered.viewModel,
				bmp: rendered.frame,
			});
			response = frameJson(envelope, { sleepSeconds, serverTime: now, profilePhase });
		} else if (format === 'svg') {
			// The renderer always produces the SVG for `format: 'svg'`. Gzipped per
			// ADR-0001 like the BMP body, honouring Accept-Encoding the same way.
			const svgBytes = new TextEncoder().encode(rendered.svg as string);
			const body = acceptsGzip ? await gzip(svgBytes) : svgBytes;
			response = frameSvg(body, {
				gzip: acceptsGzip,
				sleepSeconds,
				serverTime: now,
				profilePhase,
			});
		} else {
			// BMP path — the renderer always rasterises a frame for `format: 'bmp'`.
			const frame = rendered.frame as Uint8Array;
			const body = acceptsGzip ? await gzip(frame) : frame;
			response = frameOk(body, {
				gzip: acceptsGzip,
				sleepSeconds,
				serverTime: now,
				profilePhase,
			});
		}

		// Single completion log covering the full critical path (auth → render →
		// encode). Timing lives in the trace span, not a logged field (#54).
		log.info('frame.completed', {
			hardwareId,
			requestId,
			slug,
			layoutKey: layout,
			profilePhase,
			format,
		});
		return response;
	} catch (err) {
		// Failure boundary (ADR-0011). Map any throw to a problem type — known
		// AppErrors pass through, anything else becomes `internal` — then log it
		// and return the problem+json response. No re-throw: the contract owns the
		// status, sleep, and body, so CF never sees a bare 500.
		const error = err instanceof AppError ? err : internalError();
		const fields: Record<string, unknown> = {
			hardwareId,
			requestId,
			slug,
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
			phaseCadence,
			requestId,
			profilePhase: resolvedPhase,
		});
	}
}
