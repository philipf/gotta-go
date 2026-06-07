// Profile-phase resolver. Maps (radiator, now) → active profile phase, its
// layout, and the clamped sleep duration (30s ≤ n ≤ 14400s per glossary §8).
// An active phase's sleep is its refresh interval truncated at the next phase
// boundary (any phase start or the active phase's own end), so a long-interval
// phase never oversleeps into the next phase or the idle handoff. When server
// time is outside every configured phase, falls through to the idle profile
// (ADR-0003 §"Idle profile" / #17): renders the idle layout and sleeps until
// the next phase opens, capped at the 4h ceiling.

import type { Radiator } from '../config/lookup';
import type { ProfilePhase } from '../config/types';
import type { LayoutKey } from '../features/registry';
import { GLOBAL, SYSTEM_IDLE_DEFAULT } from '../config/data';
import { hhmm } from '../shared/hhmm';

const SLEEP_FLOOR = 30;
const SLEEP_CEILING = 14400;
const MINUTES_PER_DAY = 1440;

// The literal X-Profile-Phase value for the idle fall-through (ADR-0003). The
// idle profile is not a configured phase, so it has no per-profile key.
const IDLE_PROFILE_PHASE = 'idle_profile';

export type ProfilePhaseResolution = {
	profilePhase: string;
	phase: ProfilePhase;
	layout: LayoutKey;
	sleepSeconds: number;
};

// Local wall-clock minutes-since-midnight for `now` in the given timezone.
// Derived from the shared HH:MM wall-clock string so we stay free of a date
// library and stay DST-correct for ordinary days (the once-a-year ambiguous
// hour is out of scope per the plan).
function nowMinutes(now: Date, tz: string): number {
	const [h, m] = hhmm(now, tz).split(':');
	return Number(h) * 60 + Number(m);
}

// "HH:MM" → minutes since midnight.
function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(':');
	return Number(h) * 60 + Number(m);
}

function clampSleep(seconds: number): number {
	return Math.min(SLEEP_CEILING, Math.max(SLEEP_FLOOR, seconds));
}

// Minutes from `mins` until the next phase start, wrapping past midnight. A
// phase starting exactly at `mins` would have matched the half-open window, so
// a 0 delta means the *next* occurrence — a full day away. With no phases at
// all the reduce yields Infinity, which the caller clamps to the 4h ceiling.
function minutesUntilNextPhaseStart(phases: ProfilePhase[], mins: number): number {
	return phases.reduce((best, p) => {
		const raw = (toMinutes(p.startTime) - mins + MINUTES_PER_DAY) % MINUTES_PER_DAY;
		const delta = raw === 0 ? MINUTES_PER_DAY : raw;
		return Math.min(best, delta);
	}, Infinity);
}

// Selects the phase whose half-open [startTime, endTime) window contains the
// local wall-clock time. Outside every window, falls through to the idle
// profile: the slug's `idle` override or the system default, sleeping until the
// next phase opens (ADR-0003).
export function resolveProfilePhase(radiator: Radiator, now: Date): ProfilePhaseResolution {
	const phases = radiator.profile.phases;
	const mins = nowMinutes(now, GLOBAL.timezone);
	const active = phases.find(
		(p) => mins >= toMinutes(p.startTime) && mins < toMinutes(p.endTime),
	);

	if (active) {
		// Truncate the refresh interval at the next boundary: the earliest other
		// phase start, or the active phase's own end (where the idle profile takes
		// over if no phase starts there). mins < endTime per the half-open window,
		// so the end delta is always ≥ 1 minute.
		const untilBoundary = Math.min(
			minutesUntilNextPhaseStart(phases, mins),
			toMinutes(active.endTime) - mins,
		);
		return {
			profilePhase: active.key,
			phase: active,
			layout: active.layout,
			sleepSeconds: clampSleep(Math.min(active.refreshIntervalMinutes, untilBoundary) * 60),
		};
	}

	// Idle fall-through (ADR-0003). Wake exactly when the next configured phase
	// opens, capped at 4h. The synthesised phase exists only to satisfy the
	// RenderContext shape — idle_jokes ignores its fields (no transit targets).
	const idle = radiator.profile.idle ?? SYSTEM_IDLE_DEFAULT;
	const idlePhase: ProfilePhase = {
		key: IDLE_PROFILE_PHASE,
		startTime: '00:00',
		endTime: '00:00',
		layout: idle.layout,
		refreshIntervalMinutes: 0,
	};
	return {
		profilePhase: IDLE_PROFILE_PHASE,
		phase: idlePhase,
		layout: idle.layout,
		sleepSeconds: clampSleep(minutesUntilNextPhaseStart(phases, mins) * 60),
	};
}
