import { describe, it, expect } from 'vitest';
import { lookupRadiator } from './lookup';

describe('config.lookupRadiator', () => {
	it('returns the seeded profile for bedroom-philip-tania', () => {
		const profile = lookupRadiator('bedroom-philip-tania');

		expect(profile).toBeDefined();
		expect(profile?.slug).toBe('bedroom-philip-tania');
		expect(profile?.timezone).toBe('Pacific/Auckland');
		expect(profile?.phases.length).toBeGreaterThan(0);
	});

	it('returns undefined for an unknown slug', () => {
		expect(lookupRadiator('ghost')).toBeUndefined();
	});
});
