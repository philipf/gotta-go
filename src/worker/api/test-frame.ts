// Intent-named scenario slugs for one-click visual smoke (GH #21). A request
// with X-Radiator-Slug: test-<phaseKey> resolves to a synthetic radiator whose
// profile holds exactly that phase, widened to all-day — so the frame renders
// the named phase's *intent* regardless of wall-clock time, and never breaks
// when schedule windows are re-tuned.
//
// Reuses the production transit targets (zero new seed data), and auto-extends:
// every phase anyone adds to a profile is instantly testable as test-<itsKey>.
// Unconditional by design — these resolve in every environment, no env gate
// (see GH #21). The complementary X-Debug-Now override (debug/dev-time.ts) exercises
// *real* phase selection at a chosen time; these name a phase directly.

import { PROFILES } from '../config/data';
import type { Radiator } from '../config/lookup';
import { renderFrame } from './frame';

const TEST_PREFIX = 'test-';

// Resolves a `test-<phaseKey>` slug to a synthetic radiator carrying just that
// phase, widened to the full day. The window is [00:00, 24:00) — a half-open
// 24:00 (`[0, 1440)`) means resolveProfilePhase's find matches at every minute,
// so it never falls through to the idle profile (#17): a test- slug always
// renders its named phase, never overnight jokes. `days` is dropped for the
// same reason the times are overridden — a weekday-only phase (#92) must still
// render its intent on a weekend, so the synthetic phase is eligible every day.
// Unknown key → undefined → 404, fail-closed like lookupRadiator. First match
// wins; a config.test.ts assertion keeps phase keys globally unique so there is
// nothing to disambiguate.
export function resolveTestRadiator(slug: string): Radiator | undefined {
	if (!slug.startsWith(TEST_PREFIX)) return undefined;
	const key = slug.slice(TEST_PREFIX.length);
	for (const profile of Object.values(PROFILES)) {
		const phase = profile.phases.find((p) => p.key === key);
		if (phase) {
			return {
				slug,
				profile: {
					name: profile.name,
					phases: [{ ...phase, startTime: '00:00', endTime: '24:00', days: undefined }],
				},
			};
		}
	}
	return undefined;
}

// Frame handler for test- scenario slugs: renderFrame with the synthetic
// resolver injected. Auth and response shaping are single-sourced in
// renderFrame, identical to the production path.
export function handleTestFrame(
	request: Request,
	env: Env,
	now: Date,
): Promise<Response> {
	return renderFrame(request, env, now, resolveTestRadiator);
}
