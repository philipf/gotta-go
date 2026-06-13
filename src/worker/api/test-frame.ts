// Resolves test-<phaseKey> slugs to synthetic radiators for visual smoke testing;
// auto-extends to every new phase without new seed data.

import { PROFILES } from '../config/data';
import type { Radiator } from '../config/lookup';
import { renderFrame } from './frame';

// Frame handler for test- scenario slugs: renderFrame with the synthetic
// resolver injected. Auth and response shaping are single-sourced in
// renderFrame, identical to the production path.
export function handleTestFrame(request: Request, env: Env, now: Date): Promise<Response> {
  return renderFrame(request, env, now, resolveTestRadiator);
}

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
