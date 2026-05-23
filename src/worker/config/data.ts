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

// PRD §9 `radiators:` block — radiator slug → profile-name reference.
// The slug is the X-Radiator-Slug header value, hardcoded in firmware.
// The reference is resolved at lookup time so callers see a fully
// populated `Radiator` with its `profile` inlined.
export const RADIATOR_REFS: Record<string, { slug: string; profileName: string }> = {
	'bedroom-philip-tania': {
		slug: 'bedroom-philip-tania',
		profileName: 'philip_and_tania',
	},
};
