import { describe, it, expect } from 'vitest';
import { buildViewModel, resolvePhase } from './index';
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

describe('minimal_clock.buildViewModel', () => {
	it('returns slug + HH:MM time + "Dow DD Mon" date in the profile timezone', () => {
		// 2026-05-23T06:48:00Z = 2026-05-23T18:48:00+12:00 (Pacific/Auckland)
		const vm = buildViewModel(seedProfile, new Date('2026-05-23T06:48:00Z'));

		expect(vm.slug).toBe('bedroom-philip-tania');
		expect(vm.time).toMatch(/^\d{2}:\d{2}$/);
		expect(vm.date).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
	});
});
