// Wire-format → domain mapper. Per ADR-0005 §Verification rule 2, this is the
// only file that performs the wire→domain transformation. Consumers of the
// gateway see the domain-shaped Joke only — never icanhazdadjoke field names.

import type { WireJoke } from './types';
import type { Joke } from './icanhazdadjoke';

// The wire `joke` arrives as a single line; trim incidental whitespace so the
// renderer wraps clean text. `id` passes through for diagnostics/logging.
export function toJoke(raw: WireJoke): Joke {
	return { id: raw.id, text: raw.joke.trim() };
}
