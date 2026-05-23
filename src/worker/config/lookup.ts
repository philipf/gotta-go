// Public surface of the config/ module: slug → fully-populated Radiator
// resolver, plus re-exports of the domain types and GLOBAL.

import { PROFILES, RADIATOR_REFS } from './data';
import type { Radiator } from './types';

export type { Radiator, Profile, ProfilePhase, Global, LayoutKey } from './types';
export { GLOBAL } from './data';

// Resolves a radiator slug to a fully populated Radiator (profile inlined).
// Returns undefined when the slug is unknown, or when its profile-name
// reference points at a missing profile (config error — fail closed).
export function lookupRadiator(slug: string): Radiator | undefined {
	const ref = RADIATOR_REFS[slug];
	if (!ref) return undefined;
	const profile = PROFILES[ref.profileName];
	if (!profile) return undefined;
	return { slug: ref.slug, profile };
}
