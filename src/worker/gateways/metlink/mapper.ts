// Wire-format → domain mapper. Per ADR-0005 §Verification rule 2, this is
// the only file that performs the wire→domain transformation. Consumers of
// the gateway see domain-shaped types only — never Metlink field names.

import type { WireDeparture, WireResponse } from './types';
import type { Arrival, StopState } from './metlink';

// `closed: true` dominates regardless of the departures array. The serviceId
// and destinationStopId filters are intentionally not applied in that branch.
// `destinationStopId` (when set) is a second filter applied after serviceId:
// only departures bound for a matching `destination.stop_id` survive, so a
// route that branches to several termini at a shared stop is narrowed to the
// wanted terminus (#68). Absent → no destination filter (unchanged behaviour).
export function toStopState(
	raw: WireResponse,
	serviceId: string | string[],
	destinationStopId?: string | string[],
): StopState {
	if (raw.closed) return { kind: 'closed' };
	const serviceIds = Array.isArray(serviceId) ? serviceId : [serviceId];
	const destIds =
		destinationStopId === undefined
			? undefined
			: Array.isArray(destinationStopId)
				? destinationStopId
				: [destinationStopId];
	return {
		kind: 'open',
		arrivals: raw.departures
			.filter((d) => serviceIds.includes(d.service_id))
			.filter((d) => destIds === undefined || destIds.includes(d.destination?.stop_id ?? ''))
			.map(toArrival),
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
		delaySeconds: parseDelaySeconds(d.delay),
		status: normalizeStatus(d.status),
		tripId: d.trip_id,
	};
}

const DURATION_RE = /^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/;

export function parseDelaySeconds(iso: string): number {
	const m = iso.match(DURATION_RE);
	if (!m) {
		console.warn(`metlink: unable to parse delay duration "${iso}"`);
		return 0;
	}
	const [, sign, h, mn, s] = m;
	const total =
		parseInt(h ?? '0', 10) * 3600 +
		parseInt(mn ?? '0', 10) * 60 +
		Math.round(parseFloat(s ?? '0'));
	return sign === '-' ? -total : total;
}

export function normalizeStatus(wire: string | null): Arrival['status'] {
	if (wire === null) return 'scheduled';
	const lower = wire.toLowerCase();
	if (lower === 'delayed') return 'delayed';
	if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
	// "ontime" — monitored and running to schedule. The domain has no distinct
	// on-time state (the union is scheduled | delayed | cancelled), so it folds
	// into 'scheduled'; recognising it keeps the log quiet (#41).
	if (lower === 'ontime' || lower === 'on-time' || lower === 'on time') {
		return 'scheduled';
	}
	console.warn(`metlink: unknown status "${wire}"`);
	return 'scheduled';
}
