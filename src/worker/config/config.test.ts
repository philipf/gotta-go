import { describe, it, expect } from 'vitest';
import { lookupRadiator } from './lookup';
import { PROFILES } from './data';

describe('config.lookupRadiator', () => {
	it('returns a fully populated Radiator for bedroom-philip-tania', () => {
		const radiator = lookupRadiator('bedroom-philip-tania');

		expect(radiator).toBeDefined();
		expect(radiator?.slug).toBe('bedroom-philip-tania');
		expect(radiator?.profile.name).toBe('philip_and_tania');
		expect(radiator?.profile.phases.length).toBeGreaterThan(0);
	});

	it('returns undefined for an unknown slug', () => {
		expect(lookupRadiator('ghost')).toBeUndefined();
	});

	it('seeds philip_and_tania with a morning_commute priority_split phase carrying two transit targets (bus + train)', () => {
		const radiator = lookupRadiator('bedroom-philip-tania');

		const phase = radiator?.profile.phases.find((p) => p.key === 'morning_commute');
		expect(phase?.layout).toBe('priority_split');
		expect(phase?.transitTargets).toHaveLength(2);

		const [bus, train] = phase?.transitTargets ?? [];
		expect(bus?.mode).toBe('bus');
		expect(bus?.stopId).toBe('3234');
		expect(bus?.serviceId).toBe('1');

		expect(train?.mode).toBe('train');
		expect(train?.stopId).toBe('TAKA1');
		expect(train?.serviceId).toBe('KPL');
	});

	it('seeds office-f5 with full-day coverage: calendar phases bracketing the office_afternoon_commute (#86)', () => {
		const radiator = lookupRadiator('office-f5');

		expect(radiator?.profile.name).toBe('philip_office');
		expect(radiator?.profile.phases).toHaveLength(3);

		const [morning, commute, evening] = radiator?.profile.phases ?? [];
		expect(morning?.key).toBe('morning_calendar');
		expect(morning?.startTime).toBe('00:00');
		expect(morning?.endTime).toBe('15:00');
		expect(morning?.layout).toBe('dual_month_calendar');
		expect(morning?.refreshIntervalMinutes).toBe(240);

		expect(commute?.key).toBe('office_afternoon_commute');
		expect(commute?.startTime).toBe('15:00');
		expect(commute?.endTime).toBe('19:30');
		expect(commute?.layout).toBe('priority_split');
		expect(commute?.refreshIntervalMinutes).toBe(1);

		expect(evening?.key).toBe('evening_calendar');
		expect(evening?.startTime).toBe('19:30');
		expect(evening?.endTime).toBe('24:00');
		expect(evening?.layout).toBe('dual_month_calendar');
		expect(evening?.refreshIntervalMinutes).toBe(240);
	});

	it('shares one city→home transit-target constant between the bedroom and office commute phases (#86)', () => {
		const bedroom = lookupRadiator('bedroom-philip-tania')?.profile.phases.find(
			(p) => p.key === 'afternoon_commute',
		);
		const office = lookupRadiator('office-f5')?.profile.phases.find(
			(p) => p.key === 'office_afternoon_commute',
		);

		// Same reference, not merely equal values — filter fixes like the
		// Churton Park terminus pin (#68) or the "All stops" express filter
		// (#77) must reach both radiators at once.
		expect(office?.transitTargets).toBe(bedroom?.transitTargets);

		const [bus, train] = office?.transitTargets ?? [];
		expect(bus?.stopId).toBe('5012');
		expect(bus?.destinationStopId).toBe('3281');
		expect(train?.stopId).toBe('WELL');
		expect(train?.destinationNameIncludes).toBe('All stops');
	});

	it('seeds bedroom-daughter with a morning_school_run priority_split phase carrying one bus transit target', () => {
		const radiator = lookupRadiator('bedroom-daughter');

		expect(radiator?.profile.name).toBe('daughter_school');
		const phase = radiator?.profile.phases.find((p) => p.key === 'morning_school_run');
		expect(phase?.layout).toBe('priority_split');
		expect(phase?.transitTargets).toHaveLength(1);

		const target = phase?.transitTargets?.[0];
		expect(target?.mode).toBe('bus');
		expect(target?.stopId).toBe('3234');
		expect(target?.serviceId).toEqual(['634', '635']);
		expect(target?.timeToStopMins).toBe(5);
		expect(target?.comfortBuffer).toBe(3);
	});
});

describe('phase keys', () => {
	// The test-<phaseKey> scenario slugs (GH #21) resolve a phase by its key
	// across every profile, first-match wins. Globally-unique keys keep that
	// resolution unambiguous; this guard fails the moment a duplicate is
	// introduced — before it can ship — so no runtime throw path is needed.
	it('are globally unique across all profiles', () => {
		const keys = Object.values(PROFILES).flatMap((profile) =>
			profile.phases.map((phase) => phase.key),
		);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
