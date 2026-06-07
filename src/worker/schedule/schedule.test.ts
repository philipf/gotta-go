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
	// 05:45. May = NZST (UTC+12), so local time = UTC + 12h.
	it('idle sleep never overruns the next phase - caps produce intermediate wakes (regression #17)', () => {
		const radiator = lookupRadiator('bedroom-philip-tania')!;

		// 21:00 NZST: 8h45m to 05:45 → capped to 4h. +4h = 01:00, still in the gap.
		const at21 = resolveProfilePhase(radiator, new Date('2026-05-31T09:00:00Z'));
		expect(at21.profilePhase).toBe('idle_profile');
		expect(at21.sleepSeconds).toBe(14400);

		// 01:00 NZST: 4h45m to 05:45 → still capped to 4h. +4h = 05:00, still idle.
		const at01 = resolveProfilePhase(radiator, new Date('2026-05-31T13:00:00Z'));
		expect(at01.profilePhase).toBe('idle_profile');
		expect(at01.sleepSeconds).toBe(14400);

		// 05:00 NZST: 45 min to 05:45 → under the cap, sleeps exactly to the start.
		const at05 = resolveProfilePhase(radiator, new Date('2026-05-31T17:00:00Z'));
		expect(at05.profilePhase).toBe('idle_profile');
		expect(at05.sleepSeconds).toBe(2700);

		// 05:45 NZST: the half-open window opens → morning_commute, not idle.
		const at0545 = resolveProfilePhase(radiator, new Date('2026-05-31T17:45:00Z'));
		expect(at0545.profilePhase).toBe('morning_commute');
		expect(at0545.layout).toBe('priority_split');

		// No overrun: every capped idle wake lands at or before the 05:45 start.
		const FIRST_PHASE_START_MIN = 5 * 60 + 45;
		for (const [localMin, sleep] of [
			[21 * 60, at21.sleepSeconds],
			[1 * 60, at01.sleepSeconds],
			[5 * 60, at05.sleepSeconds],
		] as const) {
			const wakeMin = (localMin + sleep / 60) % (24 * 60);
			expect(wakeMin).toBeLessThanOrEqual(FIRST_PHASE_START_MIN);
		}
	});

	// An active phase's sleep is min(refresh interval, time to the next phase
	// boundary) so a long-interval phase never oversleeps the next phase start
	// or its own end (the idle handoff). June = NZST (UTC+12).
	it('truncates an active-phase sleep at the next phase boundary', () => {
		const radiator = lookupRadiator('bedroom-philip-tania')!;

		// 09:30 NZST: daytime_calendar (180-min refresh); afternoon_commute opens
		// 15:15 (345 min away) → the full interval fits, sleep = 180 min.
		const morning = resolveProfilePhase(radiator, new Date('2026-06-06T21:30:00Z'));
		expect(morning.profilePhase).toBe('daytime_calendar');
		expect(morning.sleepSeconds).toBe(180 * 60);

		// 14:00 NZST: 75 min to the 15:15 afternoon_commute start → truncated so
		// the commute pickup is not delayed by the 3h interval.
		const preCommute = resolveProfilePhase(radiator, new Date('2026-06-07T02:00:00Z'));
		expect(preCommute.profilePhase).toBe('daytime_calendar');
		expect(preCommute.sleepSeconds).toBe(75 * 60);

		// 20:45 NZST: afternoon_commute (1-min refresh) — short intervals are
		// unaffected by the 21:00 end boundary.
		const commute = resolveProfilePhase(radiator, new Date('2026-06-07T08:45:00Z'));
		expect(commute.profilePhase).toBe('afternoon_commute');
		expect(commute.sleepSeconds).toBe(60);
	});

	it("truncates at the active phase's own end when no phase starts there", () => {
		// daughter afternoon_idle (30-min refresh) ends 21:00 with nothing
		// adjacent — the idle profile takes over, so 20:45 NZST sleeps 15 min to
		// the handoff, not the flat 30.
		const at2045 = resolveProfilePhase(multiPhaseRadiator, new Date('2026-06-07T08:45:00Z'));
		expect(at2045.profilePhase).toBe('afternoon_idle');
		expect(at2045.sleepSeconds).toBe(15 * 60);
	});

	// office-f5 (#86) covers the full day — 00:00–15:00 / 15:00–19:30 /
	// 19:30–24:00 — so the idle profile must never engage there, including
	// across the 24:00 end time (a first in the config: toMinutes("24:00") =
	// 1440 sits just above the 23:59 wall-clock maximum). June = NZST (UTC+12).
	it('never resolves idle for office-f5 — full-day coverage incl. the 24:00 end (#86)', () => {
		const radiator = lookupRadiator('office-f5')!;

		// 09:00 NZST → morning_calendar at the 4h cap.
		const morning = resolveProfilePhase(radiator, new Date('2026-06-07T21:00:00Z'));
		expect(morning.profilePhase).toBe('morning_calendar');
		expect(morning.layout).toBe('dual_month_calendar');
		expect(morning.sleepSeconds).toBe(14400);

		// 15:00 NZST: half-open boundary — the commute window opens.
		const commute = resolveProfilePhase(radiator, new Date('2026-06-08T03:00:00Z'));
		expect(commute.profilePhase).toBe('office_afternoon_commute');
		expect(commute.layout).toBe('priority_split');
		expect(commute.sleepSeconds).toBe(60);

		// 19:30 NZST: commute hands off to the evening calendar, not idle.
		const evening = resolveProfilePhase(radiator, new Date('2026-06-08T07:30:00Z'));
		expect(evening.profilePhase).toBe('evening_calendar');
		expect(evening.layout).toBe('dual_month_calendar');

		// 23:50 NZST: still inside evening_calendar's [19:30, 24:00) window —
		// no idle gap before midnight; sleep truncates to the 00:00 boundary
		// where morning_calendar takes over.
		const lateNight = resolveProfilePhase(radiator, new Date('2026-06-08T11:50:00Z'));
		expect(lateNight.profilePhase).toBe('evening_calendar');
		expect(lateNight.sleepSeconds).toBe(10 * 60);

		// 00:00 NZST: midnight rollover lands in morning_calendar.
		const midnight = resolveProfilePhase(radiator, new Date('2026-06-08T12:00:00Z'));
		expect(midnight.profilePhase).toBe('morning_calendar');
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
