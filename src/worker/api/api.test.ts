import { describe, it, expect } from 'vitest';
import { notFound, unauthorized, unknownRadiator } from './errors';
import { frameOk, frameSvg } from './response';

describe('api.errors.unauthorized', () => {
	it('returns a 401 with body "unauthorized" and X-Sleep-Seconds: 3600', async () => {
		const res = unauthorized();

		expect(res.status).toBe(401);
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
		expect(await res.text()).toBe('unauthorized');
	});
});

describe('api.errors.unknownRadiator', () => {
	it('returns a 404 with body "unknown radiator" and X-Sleep-Seconds: 3600', async () => {
		const res = unknownRadiator();

		expect(res.status).toBe(404);
		expect(res.headers.get('X-Sleep-Seconds')).toBe('3600');
		expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
		expect(await res.text()).toBe('unknown radiator');
	});
});

describe('api.errors.notFound', () => {
	it('returns a bare 404 with body "not found" and no contract headers', async () => {
		const res = notFound();

		expect(res.status).toBe(404);
		expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
		expect(res.headers.get('X-Sleep-Seconds')).toBeNull();
		expect(res.headers.get('X-Profile-Phase')).toBeNull();
		expect(await res.text()).toBe('not found');
	});
});

describe('api.response.frameOk', () => {
	it('sets ADR-0003 observability headers + content-type image/bmp', () => {
		const body = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
		const res = frameOk(body, {
			gzip: true,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'all_day_clock',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/bmp');
		expect(res.headers.get('Content-Encoding')).toBe('gzip');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('300');
		expect(res.headers.get('X-Server-Time')).toBe('2026-05-23T06:48:12.000Z');
		expect(res.headers.get('X-Profile-Phase')).toBe('all_day_clock');
	});

	it('omits Content-Encoding when gzip is false (uncompressed BMP body)', () => {
		const body = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
		const res = frameOk(body, {
			gzip: false,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'all_day_clock',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/bmp');
		expect(res.headers.get('Content-Encoding')).toBeNull();
	});
});

describe('api.response.frameSvg', () => {
	// The end-to-end SVG path is verified via `pnpm dev` + curl (the bruno Frame
	// SVG requests), since the Satori pipeline that produces the SVG body is
	// blocked in the workers-pool sandbox per ADR-0005. These cover the shaper:
	// the diagnostics SVG carries the same observability headers as frameOk, only
	// the Content-Type differs, and gzip follows the same ADR-0001 rule.
	it('sets the observability headers + content-type image/svg+xml, gzipped', () => {
		const body = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // a gzip magic stub
		const res = frameSvg(body, {
			gzip: true,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'all_day_clock',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
		expect(res.headers.get('Content-Encoding')).toBe('gzip');
		expect(res.headers.get('X-Sleep-Seconds')).toBe('300');
		expect(res.headers.get('X-Server-Time')).toBe('2026-05-23T06:48:12.000Z');
		expect(res.headers.get('X-Profile-Phase')).toBe('all_day_clock');
	});

	it('omits Content-Encoding when gzip is false (uncompressed SVG body)', () => {
		const body = new TextEncoder().encode('<svg/>');
		const res = frameSvg(body, {
			gzip: false,
			sleepSeconds: 300,
			serverTime: new Date('2026-05-23T06:48:12Z'),
			profilePhase: 'all_day_clock',
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
		expect(res.headers.get('Content-Encoding')).toBeNull();
	});
});
