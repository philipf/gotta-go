import { describe, it, expect } from 'vitest';
import { route } from './router';

const TOKEN = 'test-token-123';
const env = { RADIATOR_SHARED_TOKEN: TOKEN } as Env;

function buildReq(headers: Record<string, string>, path = '/v1/frame'): Request {
	return new Request(`http://localhost${path}`, { headers });
}

describe('api.router', () => {
	it('returns 404 with body "unknown radiator" when slug does not resolve', async () => {
		const req = buildReq({
			'X-Radiator-Slug': 'ghost',
			'X-Radiator-Token': TOKEN,
		});

		const res = await route(req, env, new Date('2026-05-23T06:48:00Z'));

		expect(res.status).toBe(404);
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		expect(await res.text()).toBe('unknown radiator');
	});

	it('returns 401 with body "unauthorized" when token is missing', async () => {
		const req = buildReq({ 'X-Radiator-Slug': 'bedroom-philip-tania' });

		const res = await route(req, env, new Date('2026-05-23T06:48:00Z'));

		expect(res.status).toBe(401);
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		expect(await res.text()).toBe('unauthorized');
	});

	it('returns byte-identical 401 responses for missing vs invalid token (no oracle)', async () => {
		const now = new Date('2026-05-23T06:48:00Z');

		const noToken = await route(
			buildReq({ 'X-Radiator-Slug': 'bedroom-philip-tania' }),
			env,
			now,
		);
		const wrongToken = await route(
			buildReq({
				'X-Radiator-Slug': 'bedroom-philip-tania',
				'X-Radiator-Token': 'wrong',
			}),
			env,
			now,
		);

		expect(noToken.status).toBe(wrongToken.status);
		expect(await noToken.text()).toBe(await wrongToken.text());

		const noTokenHeaders = Object.fromEntries(noToken.headers.entries());
		const wrongTokenHeaders = Object.fromEntries(wrongToken.headers.entries());
		expect(noTokenHeaders).toEqual(wrongTokenHeaders);
	});

	it('returns 404 from the router for any non-/v1/frame path', async () => {
		const req = buildReq({}, '/');

		const res = await route(req, env, new Date('2026-05-23T06:48:00Z'));

		expect(res.status).toBe(404);
	});
});
