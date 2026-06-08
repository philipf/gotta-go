import { describe, it, expect } from 'vitest';
import { weekday } from './weekday';

describe('weekday', () => {
	it('returns the lowercase 3-letter weekday token for the given timezone', () => {
		// 2026-05-30T06:30:00Z is Saturday 18:30 in Pacific/Auckland (+12).
		const t = new Date('2026-05-30T06:30:00Z');
		expect(weekday(t, 'Pacific/Auckland')).toBe('sat');
		expect(weekday(t, 'UTC')).toBe('sat');
	});

	it('derives the weekday from the local calendar day, not UTC', () => {
		// 2026-06-07T13:00:00Z is still Sunday in UTC but 01:00 Monday in NZ (+12).
		const t = new Date('2026-06-07T13:00:00Z');
		expect(weekday(t, 'UTC')).toBe('sun');
		expect(weekday(t, 'Pacific/Auckland')).toBe('mon');
	});

	it('stays correct across a NZ daylight-saving boundary day', () => {
		// 2026-04-05 is the autumn DST switch (NZDT→NZST at 03:00); the wall clock
		// shifts but the calendar day does not — still Sunday either side.
		const t = new Date('2026-04-04T20:00:00Z'); // 09:00 NZDT, Sunday
		expect(weekday(t, 'Pacific/Auckland')).toBe('sun');
	});
});
