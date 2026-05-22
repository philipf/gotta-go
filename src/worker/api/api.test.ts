import { describe, it, expect } from 'vitest';
import { unauthorized, unknownRadiator } from './errors';
import { frameOk } from './response';

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
});
