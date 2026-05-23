// Typed WireResponse fixtures recorded from the ADR-0002 spike. Used by
// metlink.test.ts to drive fetchArrivals through a stub fetch without any
// live HTTP. Each fixture covers one of the documented payload shapes.

import type { WireResponse } from './types';

// closed: true envelope — treated as a no-service state by the mapper.
// The departures array contents are ignored when closed dominates.
export const closedStop: WireResponse = {
	closed: true,
	departures: [],
};

// Scheduled-only train departure: status null, monitored false, no live
// data yet (arrival.expected null). Source is ADR-0002's sample payload,
// augmented with trip_id/trip_headsign/name/departure fields that real
// wire payloads always carry but the ADR abridged.
export const scheduledTrain: WireResponse = {
	closed: false,
	departures: [
		{
			stop_id: 'TAKA1',
			service_id: 'KPL',
			trip_id: 'KPL__1__6407__RAIL__Rail_Sa_20260419',
			trip_headsign: 'Wellington Station',
			name: 'TakapuRdStn',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-23T06:48:00+12:00', expected: null },
			departure: { aimed: '2026-05-23T06:48:00+12:00', expected: null },
		},
	],
};
