// The only file that performs the wire→domain transformation (ADR-0005
// §Verification rule 2): nothing outside it reads icanhazdadjoke field names, so
// the rest of the Worker depends on the domain Joke, never the wire shape.

import type { WireJoke } from './wire-types';
import type { Joke } from './fetch-joke';

export function toJoke(raw: WireJoke): Joke {
	// Trim incidental surrounding whitespace from the wire `joke` so the renderer
	// wraps clean text.
	return { id: raw.id, text: raw.joke.trim() };
}
