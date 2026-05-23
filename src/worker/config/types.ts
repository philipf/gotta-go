import type { LayoutKey } from '../features/registry';

export type { LayoutKey };

// Mirrors PRD §9 `global:` — household-level settings shared by every
// radiator. The PoC seeds one record; future config gains more keys.
export type Global = {
	timezone: string;
	defaultRefreshIntervalMinutes: number;
};

// Mirrors PRD §9 profile phase — a time-of-day phase inside a profile.
// `key` is the phase identifier (e.g. `morning_commute`, `all_day_clock`).
export type ProfilePhase = {
	key: string;
	startTime: string;
	endTime: string;
	layout: LayoutKey;
	refreshIntervalMinutes: number;
};

// Mirrors PRD §9 `profiles:` entry — a named user/household configuration.
// One profile may be shared by multiple radiators (PRD §7).
export type Profile = {
	name: string;
	phases: ProfilePhase[];
};

// Mirrors PRD §9 `radiators:` entry — one physical radiator. The slug
// uniquely identifies the device (X-Radiator-Slug header, hardcoded in
// firmware); the profile is resolved at lookup time. Future per-radiator
// fields (display capabilities, etc.) attach here.
export type Radiator = {
	slug: string;
	profile: Profile;
};
