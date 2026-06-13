import { describe, it, expect } from 'vitest';
import { notFoundResponse, problemResponse } from './errors';
import { internalError, unauthorizedError, unknownRadiatorError } from '../shared/errors';
// Metlink problem factories moved to the priority_split feature (architecture guide);
// used here only as representative Fatal/Retryable AppError fixtures for the
// problemResponse shaping tests.
import { metlinkAuth, metlinkUnavailable } from '../features/priority_split/errors';
import { frameBmpResponse, frameSvgResponse } from './response';

const TYPE_BASE = 'https://github.com/philipf/gotta-go/blob/main/docs/api/errors.md';

describe('api.errors.problemResponse - unauthorized', () => {
	it('shapes a 401 problem+json with type #unauthorized and X-Sleep-Seconds 3600', async () => {
		const res = problemResponse(unauthorizedError());

		expect(res.status).toBe(401);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		expect(res.headers.get('X-Profile-Phase')).toBe('none');
		expect(await res.json()).toEqual({
			type: `${TYPE_BASE}#unauthorized`,
			title: 'Radiator not authorised',
			status: 401,
			detail: 'The X-Radiator-Token header was missing or did not match the configured shared token.',
		});
	});
});

describe('api.errors.problemResponse - unknown-radiator', () => {
	it('shapes a 404 problem+json naming the slug, X-Sleep-Seconds 3600', async () => {
		const res = problemResponse(unknownRadiatorError('bedroom-attic'));

		expect(res.status).toBe(404);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toBe(`${TYPE_BASE}#unknown-radiator`);
		expect(body.detail).toBe("No radiator is configured for slug 'bedroom-attic'.");
	});
});

describe('api.errors.problemResponse - instance + upstream_detail', () => {
	it('adds an instance URN from the request id and an upstream_detail snippet', async () => {
		const res = problemResponse(metlinkAuth(403, '{"error":"denied"}'), {
			requestId: 'abc',
			profilePhase: 'morning_commute',
		});

		expect(res.status).toBe(500);
		expect(res.headers.get('X-Profile-Phase')).toBe('morning_commute');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toBe(`${TYPE_BASE}#metlink-auth`);
		expect(body.instance).toBe('urn:gotta-go:request:abc');
		expect(body.upstream_detail).toBe('{"error":"denied"}');
	});

	it('omits instance and X-Sleep-Seconds for a Retryable error with no active phase sleep', async () => {
		const res = problemResponse(internalError());

		expect(res.status).toBe(500);
		expect(res.headers.get('X-Sleep-Seconds')).toBeNull();
		expect(res.headers.get('X-Profile-Phase')).toBe('none');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).not.toHaveProperty('instance');
		expect(body).not.toHaveProperty('upstream_detail');
	});

	it('derives a Retryable sleep from the active phase sleep duration', () => {
		const res = problemResponse(metlinkUnavailable('Metlink is unavailable (HTTP 503).'), {
			activePhaseSleepSeconds: 180,
			profilePhase: 'morning_commute',
		});

		expect(res.status).toBe(502);
		expect(res.headers.get('X-Sleep-Seconds')).toBe('180');
	});
});

describe('api.errors.notFoundResponse', () => {
	it('returns a class-less 404 problem+json with no sleep/profile headers', async () => {
		const res = notFoundResponse('GET', '/v1/frames');

		expect(res.status).toBe(404);
		expect(res.headers.get('Content-Type')).toBe('application/problem+json');
		expect(res.headers.get('X-Sleep-Seconds')).toBeNull();
		expect(res.headers.get('X-Profile-Phase')).toBeNull();
		expect(await res.json()).toEqual({
			type: `${TYPE_BASE}#not-found`,
			title: 'Not found',
			status: 404,
			detail: 'No route matches GET /v1/frames.',
		});
	});
});

describe('api.response.frameBmpResponse', () => {
	it('sets ADR-0003 observability headers + content-type image/bmp', () => {
		const body = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
		const res = frameBmpResponse(body, {
			gzip: true,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'daytime_clock',
			etag: 'W/"feedfacecafebeef"',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/bmp');
		expect(res.headers.get('Content-Encoding')).toBe('gzip');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('300');
		expect(res.headers.get('X-Server-Time')).toBe('2026-05-23T06:48:12.000Z');
		expect(res.headers.get('X-Profile-Phase')).toBe('daytime_clock');
		// The conditional-request validator rides every 200 (ADR-0013).
		expect(res.headers.get('ETag')).toBe('W/"feedfacecafebeef"');
	});

	it('omits Content-Encoding when gzip is false (uncompressed BMP body)', () => {
		const body = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
		const res = frameBmpResponse(body, {
			gzip: false,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'daytime_clock',
			etag: 'W/"feedfacecafebeef"',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/bmp');
		expect(res.headers.get('Content-Encoding')).toBeNull();
	});
});

describe('api.response.frameSvgResponse', () => {
	// The end-to-end SVG path is verified via `pnpm dev` + curl (the bruno Frame
	// SVG requests), since the Satori pipeline that produces the SVG body is
	// blocked in the workers-pool sandbox per ADR-0005. These cover the shaper:
	// the diagnostics SVG carries the same observability headers as frameBmpResponse, only
	// the Content-Type differs, and gzip follows the same ADR-0001 rule.
	it('sets the observability headers + content-type image/svg+xml, gzipped', () => {
		const body = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // a gzip magic stub
		const res = frameSvgResponse(body, {
			gzip: true,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'daytime_clock',
			etag: 'W/"feedfacecafebeef"',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
		expect(res.headers.get('Content-Encoding')).toBe('gzip');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('300');
		expect(res.headers.get('X-Server-Time')).toBe('2026-05-23T06:48:12.000Z');
		expect(res.headers.get('X-Profile-Phase')).toBe('daytime_clock');
	});

	it('omits Content-Encoding when gzip is false (uncompressed SVG body)', () => {
		const body = new TextEncoder().encode('<svg/>');
		const res = frameSvgResponse(body, {
			gzip: false,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'daytime_clock',
			etag: 'W/"feedfacecafebeef"',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
		expect(res.headers.get('Content-Encoding')).toBeNull();
	});
});
