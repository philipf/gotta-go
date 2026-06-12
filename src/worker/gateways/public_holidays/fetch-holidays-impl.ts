// Orchestration behind the gateway contract. Composes client.ts (KV read) and
// mapper.ts (wire→domain), classifying a KV failure or an unexpected payload into
// the HolidaysGatewayError surface so the caller can decide how to degrade.

import type { FetchHolidays } from './fetch-holidays';
import { readHolidaysPayload } from './client';
import { toHolidayDates } from './mapper';

export const fetchHolidaysImplementation: FetchHolidays = async (req) => {
	let stored: unknown;
	try {
		stored = await readHolidaysPayload({ kv: req.kv });
	} catch (err) {
		return { ok: false, error: { kind: 'unavailable', detail: String(err) } };
	}

	if (!Array.isArray(stored)) {
		// kv.get returns null for an absent key; any other non-array is a corrupt
		// payload. Both are equally unusable, so they share the `invalid` kind.
		const detail = stored === null ? 'key missing' : 'payload is not an array';
		return { ok: false, error: { kind: 'invalid', detail } };
	}

	return { ok: true, data: toHolidayDates(stored) };
};
