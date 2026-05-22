import type { Profile } from '../../config/index';

const SLEEP_FLOOR = 30;
const SLEEP_CEILING = 14400;

export type PhaseResolution = {
	phase: string;
	sleepSeconds: number;
};

// While minimal_clock is the only feature in tree, phase resolution lives here
// (not in a top-level schedule/ tier). The seeded config for #4 has a single
// all-day phase, so the first phase is always the active one. Multi-phase
// logic — start/end matching, idle-profile fall-through, DST — lands with #5;
// that's also when this file lifts up to schedule/index.ts.
export function resolvePhase(profile: Profile, _now: Date): PhaseResolution {
	const phase = profile.phases[0];
	const sleepSeconds = Math.min(
		SLEEP_CEILING,
		Math.max(SLEEP_FLOOR, phase.refreshIntervalMinutes * 60),
	);
	return { phase: phase.key, sleepSeconds };
}
