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
	serviceId: string;
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
	| { kind: 'upstream'; status: number }
	| { kind: 'network' };

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
		console.error(await response.text());
		return { ok: false, error: { kind: 'upstream', status: response.status } };
	}

	let json: WireResponse;
	try {
		json = (await response.json()) as WireResponse;
	} catch {
		return { ok: false, error: { kind: 'upstream', status: response.status } };
	}
	return { ok: true, data: toStopState(json, req.serviceId) };
}
