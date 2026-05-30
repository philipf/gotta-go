import { describe, it, expect } from 'vitest';
import { lookupRadiator } from './lookup';

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
