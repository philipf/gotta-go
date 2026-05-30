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

const multiPhaseRadiator: Radiator = {
	slug: 'bedroom-daughter',
	profile: {
		name: 'daughter_school',
		phases: [
			{
				key: 'morning_school_run',
				startTime: '07:15',
				endTime: '08:30',
				layout: 'priority_split',
				refreshIntervalMinutes: 2,
				transitTargets: [],
			},
			{
				key: 'afternoon_idle',
				startTime: '08:30',
				endTime: '21:00',
				layout: 'minimal_clock',
				refreshIntervalMinutes: 30,
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

	it('selects the phase whose [start,end) window contains the local wall-clock time', () => {
		// 2026-05-22T19:30:00Z = 07:30 NZST (UTC+12) — inside morning_school_run
		const morning = resolveProfilePhase(
			multiPhaseRadiator,
			new Date('2026-05-22T19:30:00Z'),
		);
		expect(morning.profilePhase).toBe('morning_school_run');
		expect(morning.layout).toBe('priority_split');

		// 2026-05-22T21:00:00Z = 09:00 NZST — inside afternoon_idle
		const afternoon = resolveProfilePhase(
			multiPhaseRadiator,
			new Date('2026-05-22T21:00:00Z'),
		);
		expect(afternoon.profilePhase).toBe('afternoon_idle');
		expect(afternoon.layout).toBe('minimal_clock');
	});

	it('treats the window as half-open — end_time belongs to the next phase', () => {
		// 08:30 NZST is the boundary: excluded from morning, included in afternoon
		const boundary = resolveProfilePhase(
			multiPhaseRadiator,
			new Date('2026-05-22T20:30:00Z'),
		);
		expect(boundary.profilePhase).toBe('afternoon_idle');
	});
});
