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
