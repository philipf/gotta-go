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
	const response = await fetchStopPredictions({
		fetch: req.fetch,
		apiKey: req.apiKey,
		stopId: req.stopId,
		limit: req.limit ?? DEFAULT_LIMIT,
	});
	const json = (await response.json()) as WireResponse;
	return { ok: true, data: toStopState(json, req.serviceId) };
}
