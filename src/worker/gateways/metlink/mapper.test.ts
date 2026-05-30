// Focused unit tests for the mapper's ISO 8601 duration parser and the
// status normaliser. The end-to-end behaviour is covered in metlink.test.ts
// via fixtures; this file exercises the edge-case grids that don't show up
// in any single recorded payload.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseDelaySeconds, normalizeStatus } from './mapper';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('parseDelaySeconds', () => {
	it.each([
		['PT0S', 0],
		['PT6M12S', 372],
		['PT1H30M', 5400],
		['-PT5M', -300],
	])('parses %s as %d seconds', (input, expected) => {
		expect(parseDelaySeconds(input)).toBe(expected);
	});

	it('returns 0 and warns on a malformed duration', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(parseDelaySeconds('garbage')).toBe(0);
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe('normalizeStatus', () => {
	it.each([
		[null, 'scheduled'],
		['delayed', 'delayed'],
		['DELAYED', 'delayed'],
		['cancelled', 'cancelled'],
		['canceled', 'cancelled'],
		['CANCELED', 'cancelled'],
		// "ontime" is a legitimate monitored-and-on-schedule status (#41), not an
		// unknown one — it folds into 'scheduled' and must not warn.
		['ontime', 'scheduled'],
		['ONTIME', 'scheduled'],
		['on-time', 'scheduled'],
		['on time', 'scheduled'],
	] as const)('normalises %s to %s', (input, expected) => {
		expect(normalizeStatus(input)).toBe(expected);
	});

	it('does not warn on the known "ontime" status', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(normalizeStatus('ontime')).toBe('scheduled');
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns 'scheduled' and warns on an unknown status", () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(normalizeStatus('unknown')).toBe('scheduled');
		expect(warn).toHaveBeenCalledOnce();
	});
});
