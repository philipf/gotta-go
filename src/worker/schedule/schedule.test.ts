import { describe, it, expect } from 'vitest';
import { resolveProfilePhase } from './resolve';
import { lookupRadiator } from '../config/lookup';
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

	it('falls through to the idle profile when no phase covers the time (ADR-0003 / #17)', () => {
		// 2026-05-22T18:00:00Z = 06:00 NZST — inside the 21:00–07:15 overnight gap.
		const idle = resolveProfilePhase(multiPhaseRadiator, new Date('2026-05-22T18:00:00Z'));

		expect(idle.profilePhase).toBe('idle_profile');
		expect(idle.layout).toBe('idle_jokes');
		expect(idle.sleepSeconds).toBeGreaterThanOrEqual(30);
		expect(idle.sleepSeconds).toBeLessThanOrEqual(14400);
	});

	it('sleeps exactly until the next phase opens, wrapping past midnight', () => {
		// 06:00 NZST → next phase morning_school_run at 07:15 = 75 min = 4500s.
		const idle = resolveProfilePhase(multiPhaseRadiator, new Date('2026-05-22T18:00:00Z'));
		expect(idle.sleepSeconds).toBe(4500);

		// 22:00 NZST → next start is 07:15 the *next* day (555 min) but the 4h
		// ceiling caps the sleep so a config bug cannot park a radiator forever.
		// 2026-05-22T10:00:00Z = 22:00 NZST.
		const lateNight = resolveProfilePhase(multiPhaseRadiator, new Date('2026-05-22T10:00:00Z'));
		expect(lateNight.profilePhase).toBe('idle_profile');
		expect(lateNight.sleepSeconds).toBe(14400);
	});

	// Regression (#17): the 4h cap is a ceiling, not a flat sleep. Walking the
	// real bedroom-philip-tania overnight gap (21:00 → morning_commute 06:30,
	// 9.5h) must never request a sleep that overruns the phase start: each capped
	// wake lands still inside the idle gap, and the final wake sleeps exactly to
	// 06:30. May = NZST (UTC+12), so local time = UTC + 12h.
	it('idle sleep never overruns the next phase - caps produce intermediate wakes (regression #17)', () => {
		const radiator = lookupRadiator('bedroom-philip-tania')!;

		// 21:00 NZST: 9.5h to 06:30 → capped to 4h. +4h = 01:00, still in the gap.
		const at21 = resolveProfilePhase(radiator, new Date('2026-05-31T09:00:00Z'));
		expect(at21.profilePhase).toBe('idle_profile');
		expect(at21.sleepSeconds).toBe(14400);

		// 01:00 NZST: 5.5h to 06:30 → still capped to 4h. +4h = 05:00, still idle.
		const at01 = resolveProfilePhase(radiator, new Date('2026-05-31T13:00:00Z'));
		expect(at01.profilePhase).toBe('idle_profile');
		expect(at01.sleepSeconds).toBe(14400);

		// 05:00 NZST: 90 min to 06:30 → under the cap, sleeps exactly to the start.
		const at05 = resolveProfilePhase(radiator, new Date('2026-05-31T17:00:00Z'));
		expect(at05.profilePhase).toBe('idle_profile');
		expect(at05.sleepSeconds).toBe(5400);

		// 06:30 NZST: the half-open window opens → morning_commute, not idle.
		const at0630 = resolveProfilePhase(radiator, new Date('2026-05-31T18:30:00Z'));
		expect(at0630.profilePhase).toBe('morning_commute');
		expect(at0630.layout).toBe('priority_split');

		// No overrun: every capped idle wake lands strictly before the 06:30 start.
		const SIX_THIRTY_MIN = 6 * 60 + 30;
		for (const [localMin, sleep] of [
			[21 * 60, at21.sleepSeconds],
			[1 * 60, at01.sleepSeconds],
			[5 * 60, at05.sleepSeconds],
		] as const) {
			const wakeMin = (localMin + sleep / 60) % (24 * 60);
			expect(wakeMin).toBeLessThanOrEqual(SIX_THIRTY_MIN);
		}
	});

	it("honours a profile's own idle override over the system default", () => {
		const overridden: Radiator = {
			slug: 'bedroom-override',
			profile: {
				name: 'override_profile',
				idle: { layout: 'minimal_clock' },
				phases: [
					{
						key: 'daytime',
						startTime: '09:00',
						endTime: '17:00',
						layout: 'minimal_clock',
						refreshIntervalMinutes: 5,
					},
				],
			},
		};
		// 06:00 NZST is outside the 09:00–17:00 window → idle, using the override.
		const idle = resolveProfilePhase(overridden, new Date('2026-05-22T18:00:00Z'));
		expect(idle.profilePhase).toBe('idle_profile');
		expect(idle.layout).toBe('minimal_clock');
	});
});
