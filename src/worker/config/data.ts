// PoC seed data for the PRD global:, profiles: and radiators: blocks. One
// profile with one all-day minimal_clock phase and one radiator slug, so
// resolution always finds a phase regardless of server time during the PoC.

import type { Global, Profile } from './types';

// PRD §9 `global:` block.
export const GLOBAL: Global = {
	timezone: 'Pacific/Auckland',
	defaultRefreshIntervalMinutes: 3,
};

// PRD §9 `profiles:` block — named profiles keyed by profile name. Each
// profile owns its phases. Multiple radiators may share one profile.
//
// The PoC seeds one profile with one all-day `minimal_clock` phase, so
// resolution always finds a phase regardless of server time. Multi-phase
// content (priority_split, idle, etc.) lands in subsequent issues.
export const PROFILES: Record<string, Profile> = {
	philip_and_tania: {
		name: 'philip_and_tania',
		phases: [
			// Morning commute (PRD §9): a two-target priority_split phase rendering
			// the bus stop and train station side by side. Stop 3234 + route 1 and
			// station TAKA1 + line KPL are the live-validated IDs from ADR-0002 (the
			// PRD's 7104/WELL/5112 are placeholders the spike replaced). Listed first
			// so its window wins over the all-day fallback during 06:30–09:00.
			{
				key: 'morning_commute',
				startTime: '06:30',
				endTime: '09:00',
				layout: 'priority_split',
				refreshIntervalMinutes: 2,
				transitTargets: [
					{
						mode: 'bus',
						stopId: '3234',
						serviceId: '1',
						timeToStopMins: 7,
						comfortBuffer: 3,
					},
					{
						mode: 'train',
						stopId: 'TAKA1',
						serviceId: 'KPL',
						timeToStopMins: 15,
						comfortBuffer: 4,
					},
				],
			},
			// Catch-all idle phase outside the commute window.
			{
				key: 'all_day_clock',
				startTime: '00:00',
				endTime: '23:59',
				layout: 'minimal_clock',
				refreshIntervalMinutes: 5,
			},
		],
	},
	// Daughter's school-run profile (PRD §9): a priority_split morning phase
	// over one bus transit target, then a minimal_clock idle phase. Stop 3234
	// + routes 634/635 validated in GH #16 / ADR-0002.
	daughter_school: {
		name: 'daughter_school',
		phases: [
			{
				key: 'morning_school_run',
				startTime: '07:15',
				endTime: '08:30',
				layout: 'priority_split',
				refreshIntervalMinutes: 2,
				transitTargets: [
					{
						mode: 'bus',
						stopId: '3234',
						serviceId: ['634', '635'],
						timeToStopMins: 5,
						comfortBuffer: 3,
					},
				],
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

// PRD §9 `radiators:` block — radiator slug → profile-name reference.
// The slug is the X-Radiator-Slug header value, hardcoded in firmware.
// The reference is resolved at lookup time so callers see a fully
// populated `Radiator` with its `profile` inlined.
export const RADIATOR_REFS: Record<string, { slug: string; profileName: string }> = {
	'bedroom-philip-tania': {
		slug: 'bedroom-philip-tania',
		profileName: 'philip_and_tania',
	},
	'bedroom-daughter': {
		slug: 'bedroom-daughter',
		profileName: 'daughter_school',
	},
};
