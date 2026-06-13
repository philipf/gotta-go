// Public contract for the public_holidays gateway: NZ public holidays from KV, request and error surface.

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
