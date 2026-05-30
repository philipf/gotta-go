// Orchestrator for GET /v1/frame. Validates the shared token, resolves the
// radiator slug → radiator and the active profile phase, dispatches to the
// layout's renderer, then shapes the response for the negotiated format: a
// gzipped BMP for the radiator (ADR-0003) or a JSON view-model envelope for the
// diagnostics path (ADR-0004). Auth, slug resolution, sleep duration, and the
// observability headers are identical across both formats.

import { validate } from '../auth/validate';
import { GLOBAL, lookupRadiator } from '../config/lookup';
import { layouts } from '../features/registry';
import { resolveProfilePhase } from '../schedule/resolve';
import { gzip } from '../shared/gzip';
import { buildFrameEnvelope } from './envelope';
import { unauthorized, unknownRadiator } from './errors';
import { resolveResponseFormat } from './format';
import { frameJson, frameOk } from './response';

export async function handleFrame(
	request: Request,
	env: Env,
	now: Date,
): Promise<Response> {
	// 1. Request — authenticate & parse
	const auth = validate(request.headers, env.RADIATOR_SHARED_TOKEN);
	if (!auth.ok) return unauthorized();

	const slug = request.headers.get('X-Radiator-Slug') ?? '';
	const radiator = lookupRadiator(slug);
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
		now,
		format,
		includeBmp,
		env,
		fetchFn: fetch,
	});

	// 3. Response — encode & shape. The observability inputs are identical
	// across both formats; only the body shape and Content-Type differ.
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
