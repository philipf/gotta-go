// renderFrame failure boundary (ADR-0011 / #59). Drives the full critical path
// through route() with a stubbed global fetch so a classified Metlink failure
// becomes a problem+json response — and exercises the unknown-throw → `internal`
// mapping by injecting a resolver that throws. The JSON variant is used so the
// Satori → BMP pipeline (blocked in the workers-pool sandbox per ADR-0005) never
// runs; the error path itself runs for real.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { route } from './router';
import { renderFrame } from './frame';

const TOKEN = 'test-token-123';
const env = { RADIATOR_SHARED_TOKEN: TOKEN, METLINK_API_KEY: 'test-key' } as Env;

// 07:30 NZST → bedroom-daughter's morning_school_run priority_split phase
// (refreshIntervalMinutes 2 → 120s phase cadence).
const NOW = new Date('2026-05-22T19:30:00Z');
const PHASE_CADENCE = '120';

function frameReq(extra: Record<string, string> = {}): Request {
	return new Request('http://localhost/v1/frame', {
		headers: {
			'X-Radiator-Slug': 'bedroom-daughter',
			'X-Radiator-Token': TOKEN,
			Accept: 'application/json',
			...extra,
		},
	});
}

function stubFetch(status: number, body = 'upstream body'): void {
	vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('renderFrame boundary — Metlink failures → problem+json', () => {
	it('maps a Metlink 401 (bad key) to a 500 metlink-auth, sleep 3600, error log', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		stubFetch(401, 'Access denied');

		const res = await route(frameReq(), env, NOW);

		expect(res.status).toBe(500);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		expect(res.headers.get('X-Profile-Phase')).toBe('morning_school_run');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toMatch(/#metlink-auth$/);
		expect(body.status).toBe(500);
		expect(body.upstream_detail).toBe('Access denied');
		expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({
			level: 'error',
			event: 'frame.error',
			problemType: 'metlink-auth',
			status: 500,
		});
	});

	it('maps a Metlink 5xx to a 502 metlink-unavailable, phase-cadence sleep, warn log', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch(503, 'upstream connect error');

		const res = await route(frameReq(), env, NOW);

		expect(res.status).toBe(502);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('X-Sleep-Seconds')).toBe(PHASE_CADENCE);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toMatch(/#metlink-unavailable$/);
		expect(body.upstream_detail).toBe('upstream connect error');
		expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
			level: 'warn',
			event: 'frame.error',
			problemType: 'metlink-unavailable',
		});
	});

	it('maps a Metlink 429 to a 502 metlink-rate-limited at the phase cadence', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch(429, 'Too Many Requests');

		const res = await route(frameReq(), env, NOW);

		expect(res.status).toBe(502);
		expect(res.headers.get('X-Sleep-Seconds')).toBe(PHASE_CADENCE);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toMatch(/#metlink-rate-limited$/);
	});

	it('echoes X-Request-Id into the problem instance URN, omitting it otherwise', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		stubFetch(403, 'denied');

		const withId = await route(frameReq({ 'X-Request-Id': 'req-42' }), env, NOW);
		expect(((await withId.json()) as Record<string, unknown>).instance).toBe(
			'urn:gotta-go:request:req-42',
		);

		vi.spyOn(console, 'error').mockImplementation(() => {});
		stubFetch(403, 'denied');
		const noId = await route(frameReq(), env, NOW);
		expect((await noId.json()) as Record<string, unknown>).not.toHaveProperty('instance');
	});

	it('returns problem+json even when the radiator negotiated Accept: image/bmp', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch(503);

		const res = await route(frameReq({ Accept: 'image/bmp' }), env, NOW);

		expect(res.status).toBe(502);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
	});
});

// Battery telemetry (#78): X-Radiator-Battery-Mv rides every frame log event as
// the numeric batteryMv field; garbage is dropped silently, never rejected. The
// success path uses a test- slug (offline minimal_clock, no Metlink fetch) so
// frame.completed fires for real without the Satori → BMP pipeline.
describe('renderFrame observability — battery telemetry', () => {
	function loggedEvent(spy: ReturnType<typeof vi.spyOn>, event: string): Record<string, unknown> {
		const line = spy.mock.calls
			.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>)
			.find((entry) => entry.event === event);
		expect(line, `expected a ${event} log line`).toBeDefined();
		return line as Record<string, unknown>;
	}

	it('logs a numeric batteryMv on frame.completed when the header is valid', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const res = await route(
			frameReq({ 'X-Radiator-Slug': 'test-daytime_clock', 'X-Radiator-Battery-Mv': '3942' }),
			env,
			NOW,
		);

		expect(res.status).toBe(200);
		expect(loggedEvent(logSpy, 'frame.completed').batteryMv).toBe(3942);
	});

	it('omits batteryMv when the header is absent', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const res = await route(frameReq({ 'X-Radiator-Slug': 'test-daytime_clock' }), env, NOW);

		expect(res.status).toBe(200);
		expect(loggedEvent(logSpy, 'frame.completed')).not.toHaveProperty('batteryMv');
	});

	it('drops an unparseable value silently — request handling unchanged', async () => {
		for (const garbage of ['abc', '-5', '39.5', '']) {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const res = await route(
				frameReq({ 'X-Radiator-Slug': 'test-daytime_clock', 'X-Radiator-Battery-Mv': garbage }),
				env,
				NOW,
			);

			expect(res.status).toBe(200);
			expect(loggedEvent(logSpy, 'frame.completed')).not.toHaveProperty('batteryMv');
			vi.restoreAllMocks();
		}
	});

	it('carries batteryMv on the failure-path events too (frame.unauthorized)', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const res = await route(
			frameReq({ 'X-Radiator-Token': 'wrong-token', 'X-Radiator-Battery-Mv': '3310' }),
			env,
			NOW,
		);

		expect(res.status).toBe(401);
		expect(loggedEvent(warnSpy, 'frame.unauthorized').batteryMv).toBe(3310);
	});
});

describe('renderFrame boundary — unknown throw → internal', () => {
	it('maps an unexpected throw to a 500 internal, logged at error', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const throwingResolver = () => {
			throw new Error('boom');
		};

		// The throw happens in slug resolution — before a profile phase is
		// resolved — so no X-Sleep-Seconds is sent (firmware 300s fallback).
		const res = await renderFrame(frameReq(), env, NOW, throwingResolver);

		expect(res.status).toBe(500);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('X-Sleep-Seconds')).toBeNull();
		expect(res.headers.get('X-Profile-Phase')).toBe('none');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toMatch(/#internal$/);
		expect(body.status).toBe(500);
		const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
		expect(logged).toMatchObject({ level: 'error', event: 'frame.error', problemType: 'internal' });
		// The raw stack is preserved for triage on an unknown throw.
		expect(logged.error.message).toBe('boom');
	});
});
