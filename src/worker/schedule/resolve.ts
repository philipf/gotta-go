// Profile-phase resolver. Maps (radiator, now) → active profile phase, its
// layout, and the clamped sleep duration (30s ≤ n ≤ 14400s per glossary §8).

import type { Radiator } from '../config/lookup';
import type { LayoutKey } from '../features/registry';

const SLEEP_FLOOR = 30;
const SLEEP_CEILING = 14400;

export type ProfilePhaseResolution = {
	profilePhase: string;
	layout: LayoutKey;
	sleepSeconds: number;
};

// Single-phase resolver: the seeded profile has one all-day phase, so the
// first phase is always the active one. Multi-phase logic — start/end
// matching in the radiator's timezone, idle-profile fall-through, DST —
// lands in a follow-up.
export function resolveProfilePhase(radiator: Radiator, _now: Date): ProfilePhaseResolution {
	const phase = radiator.profile.phases[0];
	const sleepSeconds = Math.min(
		SLEEP_CEILING,
		Math.max(SLEEP_FLOOR, phase.refreshIntervalMinutes * 60),
	);
	return { profilePhase: phase.key, layout: phase.layout, sleepSeconds };
}
