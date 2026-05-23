// Wire-format → domain mapper. Per ADR-0005 §Verification rule 2, this is
// the only file that performs the wire→domain transformation. Consumers of
// the gateway see domain-shaped types only — never Metlink field names.

import type { WireDeparture, WireResponse } from './types';
import type { Arrival, StopState } from './metlink';

// `closed: true` dominates regardless of the departures array. The
// serviceId filter is intentionally not applied in that branch.
export function toStopState(raw: WireResponse, serviceId: string): StopState {
	if (raw.closed) return { kind: 'closed' };
	return {
		kind: 'open',
		arrivals: raw.departures.filter((d) => d.service_id === serviceId).map(toArrival),
	};
}

function toArrival(d: WireDeparture): Arrival {
	// At origin stops arrival.aimed is absent — fall back to departure.aimed
	// (ADR-0002). The non-null assertion holds because the upstream always
	// populates one of the two for a real departure entry.
	const scheduledIso = (d.arrival.aimed ?? d.departure.aimed)!;
	const predictedIso = d.arrival.expected ?? d.departure.expected ?? scheduledIso;
	return {
		serviceId: d.service_id,
		tripHeadsign: d.trip_headsign ?? '',
		name: d.name ?? '',
		scheduled: new Date(scheduledIso),
		predicted: new Date(predictedIso),
		delaySeconds: 0,
		status: 'scheduled',
		tripId: d.trip_id,
	};
}
