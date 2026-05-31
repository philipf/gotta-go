// Public interface for the Metlink gateway. Composes client.ts (HTTP) and
// mapper.ts (wire→domain). Exposes domain-shaped types only — callers
// never see Metlink field names. Per ADR-0005 §Gateways, this file is the
// bulkhead between upstream wire format and the rest of the Worker.

import { fetchStopPredictions } from './client';
import { toStopState } from './mapper';
import type { WireResponse } from './types';

const DEFAULT_LIMIT = 5;

export type FetchArrivalsRequest = {
	fetch: typeof fetch;
	apiKey: string;
	stopId: string;
	serviceId: string | string[];
	limit?: number;
};

export type Arrival = {
	serviceId: string;
	tripHeadsign: string;
	name: string;
	scheduled: Date;
	predicted: Date;
	delaySeconds: number;
	status: 'scheduled' | 'delayed' | 'cancelled';
	tripId: string;
};

export type StopState =
	| { kind: 'open'; arrivals: Arrival[] }
	| { kind: 'closed' };

export type GatewayError =
	| { kind: 'auth' }
	| { kind: 'rate_limited' }
	// `detail` is a truncated snippet of the upstream body, captured here so it
	// stays quarantined in the gateway (ADR-0005) while the caller can log it
	// (#55). Absent when the body was already consumed (malformed-JSON-on-2xx).
	| { kind: 'upstream'; status: number; detail?: string }
	| { kind: 'network' };

// Upper bound on the upstream-body snippet carried in GatewayError.detail —
// enough to diagnose a 5xx without bloating a log event.
const MAX_DETAIL = 256;

export type FetchResult =
	| { ok: true; data: StopState }
	| { ok: false; error: GatewayError };

export async function fetchArrivals(req: FetchArrivalsRequest): Promise<FetchResult> {
	let response: Response;
	try {
		response = await fetchStopPredictions({
			fetch: req.fetch,
			apiKey: req.apiKey,
			stopId: req.stopId,
			limit: req.limit ?? DEFAULT_LIMIT,
		});
	} catch {
		return { ok: false, error: { kind: 'network' } };
	}

	if (response.status === 401 || response.status === 403) {
		return { ok: false, error: { kind: 'auth' } };
	}
	if (response.status === 429) {
		return { ok: false, error: { kind: 'rate_limited' } };
	}
	if (!response.ok) {
		// Capture a truncated body snippet for diagnostics; the caller logs it
		// (#55). The gateway itself stays side-effect-free per ADR-0005.
		const body = await response.text();
		const detail = body.length > MAX_DETAIL ? body.slice(0, MAX_DETAIL) : body;
		return { ok: false, error: { kind: 'upstream', status: response.status, detail } };
	}

	let json: WireResponse;
	try {
		json = (await response.json()) as WireResponse;
	} catch {
		return { ok: false, error: { kind: 'upstream', status: response.status } };
	}
	return { ok: true, data: toStopState(json, req.serviceId) };
}
