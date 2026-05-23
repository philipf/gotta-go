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
});
