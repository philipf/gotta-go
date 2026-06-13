// Orchestration behind the gateway contract. Composes client.ts (HTTP) and
// mapper.ts (wire→domain), and classifies each HTTP failure into the
// MetlinkGatewayError taxonomy so the caller can map kind → policy (#59).

import type { FetchArrivals } from './fetch-arrivals';
import { fetchStopPredictions } from './client';
import { toStopState } from './mapper';
import type { WireResponse } from './wire-types';
import { snippet } from '../../shared/errors';

const DEFAULT_LIMIT = 5;

export const fetchArrivalsImplementation: FetchArrivals = async (req) => {
	let response: Response;
	try {
		response = await fetchStopPredictions({
			fetch: req.fetch,
			apiKey: req.apiKey,
			stopId: req.stopId,
			limit: req.limit ?? DEFAULT_LIMIT,
		});
	} catch (err) {
		// Preserve the cause: the gateway is side-effect-free (ADR-0005), so the
		// returned error value is its only channel to the structured log (#55).
		return { ok: false, error: { kind: 'network', detail: String(err) } };
	}

	if (!response.ok) {
		const status = response.status;
		const detail = snippet(await response.text());
		if (status === 401 || status === 403) {
			return { ok: false, error: { kind: 'auth', status, detail } };
		}
		if (status === 429) {
			return { ok: false, error: { kind: 'rate_limited', status, detail } };
		}
		// 5xx is the upstream's own fault and transient; any other non-2xx is a
		// config fault Metlink rejected, surfaced separately so policy can tell the
		// two apart.
		if (status >= 500) {
			return { ok: false, error: { kind: 'upstream', status, detail } };
		}
		return { ok: false, error: { kind: 'client_error', status, detail } };
	}

	let json: WireResponse;
	try {
		json = (await response.json()) as WireResponse;
	} catch (err) {
		return { ok: false, error: { kind: 'upstream', status: response.status, detail: String(err) } };
	}
	return {
		ok: true,
		data: toStopState(json, req.serviceId, req.destinationStopId, req.destinationNameIncludes),
	};
};
