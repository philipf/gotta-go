import { RADIATORS } from './data';
import type { Profile } from './types';

export type { Profile, Phase, LayoutKey } from './types';

export function lookupRadiator(slug: string): Profile | undefined {
	return RADIATORS[slug];
}
