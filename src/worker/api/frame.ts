import { validate } from '../auth/validate';
import { lookupRadiator } from '../config/lookup';
import { layouts } from '../features/registry';
import { resolvePhase } from '../schedule/resolve';
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
	const profile = lookupRadiator(slug);
	if (!profile) return unknownRadiator();

	const { phase, layout, sleepSeconds } = resolvePhase(profile, now);

	const format = resolveResponseFormat(request.headers.get('Accept'));
	const rendered = await layouts[layout](profile, now, format);

	const acceptsGzip = (request.headers.get('Accept-Encoding') ?? '').includes(
		'gzip',
	);
	const body = acceptsGzip ? await gzip(rendered) : rendered;

	return frameOk(body, {
		gzip: acceptsGzip,
		sleepSeconds,
		serverTime: now,
		profilePhase: phase,
	});
}
