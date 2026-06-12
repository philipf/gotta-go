// Public contract for the Metlink gateway — its bulkhead (ADR-0005 §Gateways).
// Kept implementation-free so a caller reads the request, responses, and error
// surface here without wading through HTTP, JSON, or status handling; those live
// in client.ts, mapper.ts, and fetch-arrivals-impl.ts.

// Expressed as a function type so the contract lives here and the implementation
// is compiler-bound to it.
export type FetchArrivals = (req: FetchArrivalsRequest) => Promise<FetchArrivalsResponse>;

export type FetchArrivalsRequest = {
	fetch: typeof fetch;
	apiKey: string;
	stopId: string;
	serviceId: string | string[];
	destinationStopId?: string | string[];
	destinationNameIncludes?: string | string[];
	limit?: number;
};

export type FetchArrivalsResponse =
	| { ok: true; data: StopState }
	| { ok: false; error: MetlinkGatewayError };

export type StopState =
	| { kind: 'open'; arrivals: Arrival[] }
	| { kind: 'closed' };

export type Arrival = {
	serviceId: string;
	tripHeadsign: string;
	name: string;
	scheduled: Date;
	predicted: Date;
	delaySeconds: number;
	status: 'scheduled' | 'early' | 'delayed' | 'cancelled';
	tripId: string;
};

// Each kind exists so the caller can map it to a distinct policy (#59):
// `auth` (401/403) and `client_error` (other 4xx) are config faults that back off
// hard; `rate_limited` (429) and `upstream` (5xx) are transient; `network` has no
// HTTP response. The `detail` snippet carries the upstream body (or the thrown
// cause for `network`) so the caller can log it while the gateway stays
// side-effect-free (ADR-0005); it is absent when the body was empty or already
// consumed (malformed-JSON-on-2xx).
export type MetlinkGatewayError =
	| { kind: 'auth'; status: number; detail?: string }
	| { kind: 'rate_limited'; status: number; detail?: string }
	| { kind: 'client_error'; status: number; detail?: string }
	| { kind: 'upstream'; status: number; detail?: string }
	| { kind: 'network'; detail?: string };

export { fetchArrivalsImplementation as fetchArrivals } from './fetch-arrivals-impl';
