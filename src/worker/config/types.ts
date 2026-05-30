// Domain types mirroring the PRD config.yaml shape (Global, ProfilePhase,
// Profile, Radiator). Re-exports LayoutKey from the feature registry so
// phase layout values are constrained to what's actually implemented.

import type { LayoutKey } from '../features/registry';
import type { Mode } from '../features/priority_split/mode-icon';

export type { LayoutKey };

// One configured stop/station a radiator watches inside a profile phase
// (glossary §7 "transit target"). `serviceId` accepts a single route or an
// any-of array per ADR-0002; `time_to_stop_mins` and `comfort_buffer` size
// the marker window (glossary §5/§6).
export type TransitTarget = {
	mode: Mode;
	stopId: string;
	serviceId: string | string[];
	timeToStopMins: number;
	comfortBuffer: number;
};

// Mirrors PRD §9 `global:` — household-level settings shared by every
// radiator. The PoC seeds one record; future config gains more keys.
export type Global = {
	timezone: string;
	defaultRefreshIntervalMinutes: number;
	// Upper bound for the Metlink /stop-predictions `limit`. The limit is applied
	// upstream across *all* services at a stop before the gateway filters to a
	// watched service, so at a shared stop a low limit can push a watched service
	// out of the window entirely — the empty result then renders no-service even
	// when buses are due (#36/#10). Set high so Metlink itself decides the
	// truncation point; it caps the value server-side.
	stopPredictionLimit: number;
};

// Mirrors PRD §9 profile phase — a time-of-day phase inside a profile.
// `key` is the phase identifier (e.g. `morning_commute`, `all_day_clock`).
export type ProfilePhase = {
	key: string;
	startTime: string;
	endTime: string;
	layout: LayoutKey;
	refreshIntervalMinutes: number;
	// Present for priority_split phases; absent for minimal_clock.
	transitTargets?: TransitTarget[];
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
