import { afterEach, describe, it, expect, vi } from 'vitest';
import { route } from './router';
import { closedStop } from '../gateways/metlink/fixtures';

const TOKEN = 'test-token-123';
const env = { RADIATOR_SHARED_TOKEN: TOKEN, METLINK_API_KEY: 'test-key' } as Env;

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

// The JSON view-model variant (ADR-0004 / #19). Exercised end-to-end through
// route() without ?include_bmp, so the Satori → BMP pipeline (blocked in the
// workers-pool sandbox per ADR-0005) never runs; the byte-identity of
// frame_bmp_base64 is verified via `pnpm dev` + curl and unit-tested in
// api/envelope.test.ts.
describe('api.router — JSON view-model variant', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the minimal_clock view model with diagnostics fields and no BMP', async () => {
		const now = new Date('2026-05-23T06:48:00Z'); // 18:48 NZST → all_day_clock
		const req = buildReq({
			'X-Radiator-Slug': 'bedroom-philip-tania',
			'X-Radiator-Token': TOKEN,
			Accept: 'application/json',
		});

		const res = await route(req, env, now);

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.profile_phase).toBe('all_day_clock');
		expect(body.layout).toBe('minimal_clock');
		expect(body.server_time).toBe('2026-05-23T06:48:00.000Z');
		expect(body.slug).toBe('bedroom-philip-tania');
		expect(body.time).toBe('18:48');
		expect(body).not.toHaveProperty('frame_bmp_base64');
	});

	it('carries observability headers identical to the BMP variant', async () => {
		const now = new Date('2026-05-23T06:48:00Z');
		const req = buildReq({
			'X-Radiator-Slug': 'bedroom-philip-tania',
			'X-Radiator-Token': TOKEN,
			Accept: 'application/json',
		});

		const res = await route(req, env, now);

		expect(res.headers.get('X-Server-Time')).toBe('2026-05-23T06:48:00.000Z');
		expect(res.headers.get('X-Profile-Phase')).toBe('all_day_clock');
		// all_day_clock refreshes every 5 min → 300s.
		expect(res.headers.get('X-Sleep-Seconds')).toBe('300');
	});

	it('returns the priority_split per-column view model with glossary field names', async () => {
		// A closed stop degrades the column to dashes, so the assertion is
		// independent of fixture timing while still exercising the column shape.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(closedStop), { status: 200 })),
		);
		const now = new Date('2026-05-22T19:30:00Z'); // 07:30 NZST → morning_school_run
		const req = buildReq({
			'X-Radiator-Slug': 'bedroom-daughter',
			'X-Radiator-Token': TOKEN,
			Accept: 'application/json',
		});

		const res = await route(req, env, now);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			profile_phase: string;
			layout: string;
			wall_clock: string;
			columns: Array<Record<string, unknown>>;
		};
		expect(body.profile_phase).toBe('morning_school_run');
		expect(body.layout).toBe('priority_split');
		expect(body.wall_clock).toBe('07:30');
		expect(body.columns).toHaveLength(1);
		expect(body.columns[0]).toEqual({
			kind: 'service',
			mode: 'bus',
			service_id: '634',
			trip_headsign: '',
			leave_in: '—',
			leave_by: '—',
			arrives: '—',
			next: '—',
			marker_ratio: 1,
		});
	});
});
