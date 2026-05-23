import { describe, it, expect } from 'vitest';
import { resolveProfilePhase } from './resolve';
import type { Radiator } from '../config/lookup';

const seedRadiator: Radiator = {
	slug: 'bedroom-philip-tania',
	profile: {
		name: 'philip_and_tania',
		phases: [
			{
				key: 'all_day_clock',
				startTime: '00:00',
				endTime: '23:59',
				layout: 'minimal_clock',
				refreshIntervalMinutes: 5,
			},
		],
	},
};

describe('schedule.resolveProfilePhase', () => {
	it('returns the active profile phase, layout, and sleep within [30, 14400]', () => {
		const result = resolveProfilePhase(seedRadiator, new Date('2026-05-23T06:48:00Z'));

		expect(result.profilePhase).toBe('all_day_clock');
		expect(result.layout).toBe('minimal_clock');
		expect(result.sleepSeconds).toBeGreaterThanOrEqual(30);
		expect(result.sleepSeconds).toBeLessThanOrEqual(14400);
	});
});
