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
// success path uses a test- slug (offline dual_month_calendar, no Metlink
// fetch) so frame.completed fires for real without the Satori → BMP pipeline.
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
			frameReq({ 'X-Radiator-Slug': 'test-daytime_calendar', 'X-Radiator-Battery-Mv': '3942' }),
			env,
			NOW,
		);

		expect(res.status).toBe(200);
		expect(loggedEvent(logSpy, 'frame.completed').batteryMv).toBe(3942);
	});

	it('omits batteryMv when the header is absent', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const res = await route(frameReq({ 'X-Radiator-Slug': 'test-daytime_calendar' }), env, NOW);

		expect(res.status).toBe(200);
		expect(loggedEvent(logSpy, 'frame.completed')).not.toHaveProperty('batteryMv');
	});

	it('drops an unparseable value silently — request handling unchanged', async () => {
		for (const garbage of ['abc', '-5', '39.5', '']) {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const res = await route(
				frameReq({ 'X-Radiator-Slug': 'test-daytime_calendar', 'X-Radiator-Battery-Mv': garbage }),
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

// Conditional frame requests (ADR-0013 / #73). Driven through route() against
// the offline dual_month_calendar daytime_calendar phase, whose view model is
// fully determined by the fixed `now` — so the ETag a JSON response carries is
// the ETag the image/bmp path derives for the same instant. The 304 path is the
// only bmp-path outcome testable in the workers-pool sandbox, and that is the
// point: the Satori → resvg pipeline is blocked here (ADR-0005), so a clean
// 304 *proves* the render never ran — reaching it would fail the test. The
// stale-validator → 200 + new-ETag flow is exercised live per ADR-0013
// §Verification (`pnpm dev` + curl).
describe('renderFrame conditional requests — ETag / If-None-Match (#73)', () => {
	const NOON = new Date('2026-05-23T00:00:00Z'); // 12:00 NZST → daytime_calendar
	const clockReq = (extra: Record<string, string> = {}): Request =>
		frameReq({ 'X-Radiator-Slug': 'bedroom-philip-tania', ...extra });

	async function learnEtag(): Promise<string> {
		const res = await route(clockReq(), env, NOON);
		expect(res.status).toBe(200);
		const etag = res.headers.get('ETag');
		expect(etag).not.toBeNull();
		return etag as string;
	}

	it('carries a weak ETag on every 200, derived from the view model', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const etag = await learnEtag();

		expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);
		// Deterministic: the same content inputs at the same instant re-derive
		// the same validator on a fresh request.
		expect(await learnEtag()).toBe(etag);
	});

	it('answers 304 with no body on the bmp path when If-None-Match matches — render skipped', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const etag = await learnEtag();

		const res = await route(
			clockReq({ Accept: 'image/bmp', 'If-None-Match': etag }),
			env,
			NOON,
		);

		expect(res.status).toBe(304);
		expect(await res.text()).toBe('');
		expect(res.headers.get('Content-Type')).toBeNull();
		// The shaper sets no Content-Encoding. On the wire, workerd's encoding
		// negotiation appends an incidental `Content-Encoding: gzip` for
		// gzip-advertising clients — bodiless, ignorable, documented in
		// ADR-0013 §What a 304 carries.
		expect(res.headers.get('Content-Encoding')).toBeNull();
		// Sleep authority rides every response (ADR-0003); the ETag is repeated
		// per RFC 9110 §15.4.5. daytime_calendar refreshes every 30 min → 1800s.
		expect(res.headers.get('X-Sleep-Seconds')).toBe('1800');
		expect(res.headers.get('X-Profile-Phase')).toBe('daytime_calendar');
		expect(res.headers.get('X-Server-Time')).toBe('2026-05-23T00:00:00.000Z');
		expect(res.headers.get('ETag')).toBe(etag);
		// The completion log marks the skip.
		const completed = logSpy.mock.calls
			.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>)
			.find((entry) => entry.event === 'frame.completed' && entry.format === 'bmp');
		expect(completed).toMatchObject({ notModified: true });
	});

	it('always answers 200 on the JSON diagnostics variant, even with a matching If-None-Match', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const etag = await learnEtag();

		const res = await route(clockReq({ 'If-None-Match': etag }), env, NOON);

		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.layout).toBe('dual_month_calendar');
		expect(res.headers.get('ETag')).toBe(etag);
	});

	it('returns the problem document on an error path regardless of If-None-Match', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch(503, 'upstream connect error');

		// bedroom-daughter at NOW → morning_school_run priority_split; the
		// Metlink failure throws inside buildViewModel, before the conditional
		// check is ever reached.
		const res = await route(
			frameReq({ Accept: 'image/bmp', 'If-None-Match': 'W/"feedfacecafebeef"' }),
			env,
			NOW,
		);

		expect(res.status).toBe(502);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('ETag')).toBeNull();
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
