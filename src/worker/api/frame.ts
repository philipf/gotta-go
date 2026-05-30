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
import { buildFrameEnvelope } from './envelope';
import { unauthorized, unknownRadiator } from './errors';
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
	// 1. Request — authenticate & parse
	const auth = validate(request.headers, env.RADIATOR_SHARED_TOKEN);
	if (!auth.ok) return unauthorized();

	const slug = request.headers.get('X-Radiator-Slug') ?? '';
	const radiator = resolve(slug);
	if (!radiator) return unknownRadiator();

	const format = resolveResponseFormat(request.headers.get('Accept'));
	const includeBmp =
		format === 'json' &&
		new URL(request.url).searchParams.get('include_bmp') === '1';
	const acceptsGzip = (request.headers.get('Accept-Encoding') ?? '').includes(
		'gzip',
	);

	// 2. Endpoint — resolve domain inputs & render
	const { profilePhase, phase, layout, sleepSeconds } = resolveProfilePhase(radiator, now);
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
	if (format === 'json') {
		const envelope = buildFrameEnvelope({
			profilePhase,
			layout,
			serverTime: now,
			viewModel: rendered.viewModel,
			bmp: rendered.frame,
		});
		return frameJson(envelope, { sleepSeconds, serverTime: now, profilePhase });
	}

	if (format === 'svg') {
		// The renderer always produces the SVG for `format: 'svg'`. Gzipped per
		// ADR-0001 like the BMP body, honouring Accept-Encoding the same way.
		const svgBytes = new TextEncoder().encode(rendered.svg as string);
		const body = acceptsGzip ? await gzip(svgBytes) : svgBytes;
		return frameSvg(body, {
			gzip: acceptsGzip,
			sleepSeconds,
			serverTime: now,
			profilePhase,
		});
	}

	// BMP path — the renderer always rasterises a frame for `format: 'bmp'`.
	const frame = rendered.frame as Uint8Array;
	const body = acceptsGzip ? await gzip(frame) : frame;
	return frameOk(body, {
		gzip: acceptsGzip,
		sleepSeconds,
		serverTime: now,
		profilePhase,
	});
}
