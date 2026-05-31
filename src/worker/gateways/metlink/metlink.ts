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

// Every HTTP-error kind carries the status and a truncated `detail` snippet of
// the upstream body, captured here so it stays quarantined in the gateway
// (ADR-0005) while the caller logs it (#55). `detail` is absent when the body
// is empty or was already consumed (malformed-JSON-on-2xx). `network` has no
// HTTP response, so it carries neither.
export type GatewayError =
	| { kind: 'auth'; status: number; detail?: string }
	| { kind: 'rate_limited'; status: number; detail?: string }
	| { kind: 'upstream'; status: number; detail?: string }
	| { kind: 'network' };

// Upper bound on the body snippet carried in GatewayError.detail — enough to
// diagnose a failure without bloating a log event.
const MAX_DETAIL = 256;

// Reads the error response body once and truncates it for `detail`. Returns
// undefined for an empty body so the field drops out of the log entirely.
async function bodySnippet(response: Response): Promise<string | undefined> {
	const body = await response.text();
	if (!body) return undefined;
	return body.length > MAX_DETAIL ? body.slice(0, MAX_DETAIL) : body;
}

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

	if (!response.ok) {
		// One body read for every HTTP error; the caller logs status + detail
		// (#55). The gateway stays side-effect-free per ADR-0005.
		const status = response.status;
		const detail = await bodySnippet(response);
		if (status === 401 || status === 403) {
			return { ok: false, error: { kind: 'auth', status, detail } };
		}
		if (status === 429) {
			return { ok: false, error: { kind: 'rate_limited', status, detail } };
		}
		return { ok: false, error: { kind: 'upstream', status, detail } };
	}

	let json: WireResponse;
	try {
		json = (await response.json()) as WireResponse;
	} catch {
		return { ok: false, error: { kind: 'upstream', status: response.status } };
	}
	return { ok: true, data: toStopState(json, req.serviceId) };
}
