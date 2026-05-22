import type { Profile } from './types';

// Seed config for the #4 tracer slice. One all-day phase that selects
// minimal_clock, so schedule resolution always finds a phase regardless of
// server time. Multi-phase logic + the priority_split layout land with #5.
export const RADIATORS: Record<string, Profile> = {
	'bedroom-philip-tania': {
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
	},
};
