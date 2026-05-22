import { validate } from '../auth/index';
import { lookupRadiator } from '../config/index';
import {
	buildViewModel,
	renderers,
	resolvePhase,
} from '../features/minimal_clock/index';
import { gzip } from '../shared/gzip/index';
import { unauthorized, unknownRadiator } from './errors';
import { negotiate } from './negotiate';
import { frameOk } from './response';

export async function handleFrame(
	request: Request,
	env: Env,
	now: Date,
): Promise<Response> {
	const auth = validate(request.headers, env.RADIATOR_SHARED_TOKEN);
	if (!auth.ok) return unauthorized();

	const slug = request.headers.get('X-Radiator-Slug') ?? '';
	const profile = lookupRadiator(slug);
	if (!profile) return unknownRadiator();

	const { phase, sleepSeconds } = resolvePhase(profile, now);
	const vm = buildViewModel(profile, now);

	const rendererKey = negotiate(request.headers.get('Accept'));
	const bmp = await renderers[rendererKey](vm);

	const acceptsGzip = (request.headers.get('Accept-Encoding') ?? '').includes(
		'gzip',
	);
	const body = acceptsGzip ? await gzip(bmp) : bmp;

	return frameOk(body, {
		gzip: acceptsGzip,
		sleepSeconds,
		serverTime: now,
		profilePhase: phase,
	});
}
