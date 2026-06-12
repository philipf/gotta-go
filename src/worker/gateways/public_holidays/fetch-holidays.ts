// Public contract for the public_holidays gateway — its bulkhead (ADR-0005
// §Gateways): the household's NZ public holidays (#84), read from the
// PUBLIC_HOLIDAYS KV namespace. Kept implementation-free so a caller reads the
// request, response, and error surface here; the KV read, validation, and
// wire→domain mapping live in client.ts, fetch-holidays-impl.ts, and mapper.ts.
//
// Side-effect-free like the HTTP gateways: a missing key or KV error comes back
// as an error value, not a swallowed empty set — the caller decides whether to
// soft-miss. dual_month_calendar degrades to an unshaded calendar (#84); holidays
// are decoration, so its core date math never fails.

// Expressed as a function type so the contract lives here and the implementation
// is compiler-bound to it.
export type FetchHolidays = (req: FetchHolidaysRequest) => Promise<FetchHolidaysResponse>;

export type FetchHolidaysRequest = {
	kv: KVNamespace;
};

export type FetchHolidaysResponse =
	| { ok: true; data: Set<string> }
	| { ok: false; error: HolidaysGatewayError };

// `unavailable` — the KV read itself threw; `invalid` — the key was missing or the
// stored value was not the expected array. `detail` carries the cause so the
// caller can log it while the gateway stays side-effect-free (ADR-0005).
export type HolidaysGatewayError =
	| { kind: 'unavailable'; detail?: string }
	| { kind: 'invalid'; detail?: string };

export { fetchHolidaysImplementation as fetchHolidays } from './fetch-holidays-impl';
