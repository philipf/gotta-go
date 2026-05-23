import { validate } from '../auth/validate';
import { GLOBAL, lookupRadiator } from '../config/lookup';
import { layouts } from '../features/registry';
import { resolveProfilePhase } from '../schedule/resolve';
import { gzip } from '../shared/gzip';
import { unauthorized, unknownRadiator } from './errors';
import { resolveResponseFormat } from './format';
import { frameOk } from './response';

export async function handleFrame(
	request: Request,
	env: Env,
	now: Date,
): Promise<Response> {
	const auth = validate(request.headers, env.RADIATOR_SHARED_TOKEN);
	if (!auth.ok) return unauthorized();

	const slug = request.headers.get('X-Radiator-Slug') ?? '';
	const radiator = lookupRadiator(slug);
	if (!radiator) return unknownRadiator();

	const { profilePhase, layout, sleepSeconds } = resolveProfilePhase(radiator, now);

	const format = resolveResponseFormat(request.headers.get('Accept'));
	const rendered = await layouts[layout](radiator, GLOBAL.timezone, now, format);

	const acceptsGzip = (request.headers.get('Accept-Encoding') ?? '').includes(
		'gzip',
	);
	const body = acceptsGzip ? await gzip(rendered) : rendered;

	return frameOk(body, {
		gzip: acceptsGzip,
		sleepSeconds,
		serverTime: now,
		profilePhase,
	});
}
