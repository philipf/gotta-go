import type { Profile } from '../config/lookup';
import type { LayoutKey } from '../features/registry';

const SLEEP_FLOOR = 30;
const SLEEP_CEILING = 14400;

export type PhaseResolution = {
	phase: string;
	layout: LayoutKey;
	sleepSeconds: number;
};

// Single-phase resolver: the seeded config has one all-day phase, so the first
// phase is always the active one. Multi-phase logic — start/end matching,
// idle-profile fall-through, DST — lands in a follow-up.
export function resolvePhase(profile: Profile, _now: Date): PhaseResolution {
	const phase = profile.phases[0];
	const sleepSeconds = Math.min(
		SLEEP_CEILING,
		Math.max(SLEEP_FLOOR, phase.refreshIntervalMinutes * 60),
	);
	return { phase: phase.key, layout: phase.layout, sleepSeconds };
}
