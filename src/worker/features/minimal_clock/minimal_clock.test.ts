import { describe, it, expect } from 'vitest';
import { buildViewModel } from './viewmodel';
import type { Radiator } from '../../config/lookup';

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

// Tested one layer below the public render() because the full BMP pipeline
// (Satori → resvg → BMP) is blocked inside the workers-pool sandbox per ADR-0005;
// it's exercised end-to-end via `pnpm dev` + curl instead.
describe('minimal_clock.buildViewModel', () => {
	it('returns slug + HH:MM time + "Dow DD Mon" date in the supplied timezone', () => {
		// 2026-05-23T06:48:00Z = 2026-05-23T18:48:00+12:00 (Pacific/Auckland)
		const vm = buildViewModel(
			seedRadiator,
			'Pacific/Auckland',
			new Date('2026-05-23T06:48:00Z'),
		);

		expect(vm.slug).toBe('bedroom-philip-tania');
		expect(vm.time).toMatch(/^\d{2}:\d{2}$/);
		expect(vm.date).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
	});
});
