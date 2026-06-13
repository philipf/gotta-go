import { describe, it, expect } from 'vitest';
import { resolveDevNow } from './dev-time';

function req(headers: Record<string, string> = {}): Request {
	return new Request('http://localhost/v1/frame', { headers });
}

const ON = { DEV_TIME_OVERRIDE: 'true' } as unknown as Env;
const OFF = {} as Env;

describe('resolveDevNow', () => {
	it('returns the X-Debug-Now instant when the override flag is enabled', () => {
		const now = resolveDevNow(req({ 'X-Debug-Now': '2026-06-01T07:30:00+12:00' }), ON);
		expect(now?.toISOString()).toBe('2026-05-31T19:30:00.000Z');
	});

	it('returns undefined when the override flag is off (production default)', () => {
		expect(resolveDevNow(req({ 'X-Debug-Now': '2026-06-01T07:30:00+12:00' }), OFF)).toBeUndefined();
	});

	it('returns undefined when the flag is on but no X-Debug-Now header is present', () => {
		expect(resolveDevNow(req(), ON)).toBeUndefined();
	});

	it('returns undefined for an unparseable X-Debug-Now value (falls back to real clock)', () => {
		expect(resolveDevNow(req({ 'X-Debug-Now': 'not-a-date' }), ON)).toBeUndefined();
	});
});
