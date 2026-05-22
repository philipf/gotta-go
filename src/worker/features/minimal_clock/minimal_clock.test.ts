import { describe, it, expect } from 'vitest';
import { resolvePhase } from './index';
import type { Profile } from '../../config/index';

const seedProfile: Profile = {
	slug: 'bedroom-philip-tania',
	timezone: 'Pacific/Auckland',
	phases: [
		{
			key: 'all_day_clock',
			startTime: '00:00',
			endTime: '23:59',
			layout: 'minimal_clock',
			refreshIntervalMinutes: 5,
		},
	],
};

describe('minimal_clock.resolvePhase', () => {
	it('returns the active phase and a sleep duration within [30, 14400]', () => {
		const result = resolvePhase(seedProfile, new Date('2026-05-23T06:48:00Z'));

		expect(result.phase).toBe('all_day_clock');
		expect(result.sleepSeconds).toBeGreaterThanOrEqual(30);
		expect(result.sleepSeconds).toBeLessThanOrEqual(14400);
	});
});
