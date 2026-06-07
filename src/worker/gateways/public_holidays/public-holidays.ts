// Public interface for the public_holidays gateway: NZ public holidays
// (national + Wellington region) read from the PUBLIC_HOLIDAYS KV namespace,
// written there by src/tools/fetch-nz-holidays.ts (GH #83). Returns only a
// Set of ISO dates — the stored `name` is dropped at this bulkhead because no
// caller renders it (#84); it re-enters the domain only when a feature does.
//
// First KV-backed gateway, deliberately slimmer than the HTTP ones (metlink,
// icanhazdadjoke): there is no wire protocol to bulkhead behind a client.ts /
// mapper.ts split — the whole upstream is one kv.get — so the Deep Modules
// pillar (ADR-0007) wins over structural symmetry.
//
// Soft-miss error surface, unlike every HTTP gateway: holidays are decoration
// on a frame whose core content (pure date math) cannot fail, so a missing
// key, malformed payload, or KV error degrades to an empty set + a logged
// warning — the calendar renders unshaded rather than 502ing the panel.
// Contrast idle_jokes, where the fetch IS the content and throwing is correct.

import { log } from '../../shared/log';

// Mirrors KV_KEY in src/tools/fetch-nz-holidays.ts — that tool is a standalone
// package, so the key is redeclared here rather than imported across the
// package boundary.
const KV_KEY = 'public-holidays:NZ:current';

// The stored shape the fetcher writes: a flat array of { date, name }. Read as
// unknown and validated per entry — a malformed entry is dropped, never fatal.
function entryDate(entry: unknown): string | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const date = (entry as Record<string, unknown>).date;
	return typeof date === 'string' ? date : null;
}

export type FetchHolidaysRequest = {
	kv: KVNamespace;
};

export async function fetchHolidays(req: FetchHolidaysRequest): Promise<Set<string>> {
	let stored: unknown;
	try {
		stored = await req.kv.get(KV_KEY, 'json');
	} catch (err) {
		log.warn('public_holidays.kv_read_failed', {
			message: err instanceof Error ? err.message : String(err),
		});
		return new Set();
	}
	if (!Array.isArray(stored)) {
		log.warn('public_holidays.payload_invalid', {
			reason: stored === null ? 'key missing' : 'payload is not an array',
		});
		return new Set();
	}
	return new Set(stored.map(entryDate).filter((d): d is string => d !== null));
}
