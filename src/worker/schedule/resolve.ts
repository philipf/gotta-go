// Profile-phase resolver. Maps (radiator, now) → active profile phase, its
// layout, and the clamped sleep duration (30s ≤ n ≤ 14400s per glossary §8).

import type { Radiator } from '../config/lookup';
import type { ProfilePhase } from '../config/types';
import type { LayoutKey } from '../features/registry';
import { GLOBAL } from '../config/data';

const SLEEP_FLOOR = 30;
const SLEEP_CEILING = 14400;

export type ProfilePhaseResolution = {
	profilePhase: string;
	phase: ProfilePhase;
	layout: LayoutKey;
	sleepSeconds: number;
};

// Local wall-clock minutes-since-midnight for `now` in the given timezone.
// Reuses Intl so we stay free of a date library and stay DST-correct for
// ordinary days (the once-a-year ambiguous hour is out of scope per the plan).
const MINUTES = new Map<string, Intl.DateTimeFormat>();
function nowMinutes(now: Date, tz: string): number {
	let fmt = MINUTES.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		MINUTES.set(tz, fmt);
	}
	const parts = fmt.formatToParts(now);
	const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
	const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
	return h * 60 + m;
}

// "HH:MM" → minutes since midnight.
function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(':');
	return Number(h) * 60 + Number(m);
}

// Selects the phase whose half-open [startTime, endTime) window contains the
// local wall-clock time. A request outside every window falls back to the
// first phase — TODO(#17): replace with the idle_profile fall-through.
export function resolveProfilePhase(radiator: Radiator, now: Date): ProfilePhaseResolution {
	const phases = radiator.profile.phases;
	const mins = nowMinutes(now, GLOBAL.timezone);
	const phase =
		phases.find((p) => mins >= toMinutes(p.startTime) && mins < toMinutes(p.endTime)) ??
		phases[0];

	const sleepSeconds = Math.min(
		SLEEP_CEILING,
		Math.max(SLEEP_FLOOR, phase.refreshIntervalMinutes * 60),
	);
	return { profilePhase: phase.key, phase, layout: phase.layout, sleepSeconds };
}
