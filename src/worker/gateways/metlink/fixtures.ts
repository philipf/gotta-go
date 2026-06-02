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

// Delayed train departure: status 'delayed', monitored true, live data
// present (arrival.expected populated). Source: ADR-0002 sample payload.
export const delayedTrain: WireResponse = {
	closed: false,
	departures: [
		{
			stop_id: 'TAKA1',
			service_id: 'KPL',
			trip_id: 'KPL__1__6407__RAIL__Rail_Sa_20260419',
			trip_headsign: 'Wellington Station',
			name: 'TakapuRdStn',
			delay: 'PT6M12S',
			status: 'delayed',
			monitored: true,
			arrival: {
				aimed: '2026-05-23T05:48:00+12:00',
				expected: '2026-05-23T05:54:12+12:00',
			},
			departure: {
				aimed: '2026-05-23T05:48:00+12:00',
				expected: '2026-05-23T05:54:12+12:00',
			},
		},
	],
};

// Origin-stop departure: arrival.aimed is absent entirely (ADR-0002),
// so the mapper must null-coalesce scheduled from departure.aimed.
// Verified live against stop 6001 (Wellington Station Stop C, route 17
// origin) in the ADR-0002 spike.
export const originStop: WireResponse = {
	closed: false,
	departures: [
		{
			stop_id: '6001',
			service_id: '17',
			trip_id: '17__0__400__TZM__017__017_20260419',
			trip_headsign: 'Kingston',
			name: 'Wellington Station Stop C',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { expected: null },
			departure: { aimed: '2026-05-23T07:00:00+12:00', expected: null },
		},
	],
};

// Bus stop 3234 returning three concurrent routes (1, 19, N5) in one
// response. Exercises the client-side service_id filter (ADR-0002).
// Route 1 from ADR-0002 sample; routes 19 and N5 synthesised with
// plausible neighbourhood values.
export const multiRouteBus: WireResponse = {
	closed: false,
	departures: [
		{
			stop_id: '3234',
			service_id: '1',
			trip_id: '1__1__116__TZM__232__232_20260419',
			trip_headsign: 'Island Bay',
			name: 'Westchester Dr at Waitohi Rd',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-23T06:51:00+12:00', expected: null },
			departure: { aimed: '2026-05-23T06:51:00+12:00', expected: null },
		},
		{
			stop_id: '3234',
			service_id: '19',
			trip_id: '19__1__220__TZM__220__220_20260419',
			trip_headsign: 'Johnsonville',
			name: 'Westchester Dr at Waitohi Rd',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-23T06:55:00+12:00', expected: null },
			departure: { aimed: '2026-05-23T06:55:00+12:00', expected: null },
		},
		{
			stop_id: '3234',
			service_id: 'N5',
			trip_id: 'N5__1__050__TZM__050__050_20260419',
			trip_headsign: 'Wellington Station',
			name: 'Westchester Dr at Waitohi Rd',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-23T07:10:00+12:00', expected: null },
			departure: { aimed: '2026-05-23T07:10:00+12:00', expected: null },
		},
	],
};

// Stop 3234 returning routes 634, 635, and an unrelated 636. Used to test
// the array form of serviceId — filter on ["634", "635"] should include both
// and exclude 636.
export const schoolBusMultiRoute: WireResponse = {
	closed: false,
	departures: [
		{
			stop_id: '3234',
			service_id: '634',
			trip_id: '634__1__001__TZM__634__634_20260419',
			trip_headsign: 'Newlands College',
			name: 'Westchester Drive at Waverton Terrace',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-25T07:42:00+12:00', expected: null },
			departure: { aimed: '2026-05-25T07:42:00+12:00', expected: null },
		},
		{
			stop_id: '3234',
			service_id: '635',
			trip_id: '635__1__001__TZM__635__635_20260419',
			trip_headsign: 'Newlands College',
			name: 'Westchester Drive at Waverton Terrace',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-25T07:50:00+12:00', expected: null },
			departure: { aimed: '2026-05-25T07:50:00+12:00', expected: null },
		},
		{
			stop_id: '3234',
			service_id: '636',
			trip_id: '636__1__001__TZM__636__636_20260419',
			trip_headsign: 'Churton Park',
			name: 'Westchester Drive at Waverton Terrace',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-05-25T07:55:00+12:00', expected: null },
			departure: { aimed: '2026-05-25T07:55:00+12:00', expected: null },
		},
	],
};

// Stop 5012 (Lambton Central Stop A) returning route 1 branching to three
// distinct termini in one response — Churton Park (3281), Grenada Village
// (3451) and Johnsonville West (3040). All share service_id "1", so the
// service filter alone passes all three; exercises the destinationStopId
// filter that narrows to a wanted terminus (#68). Live shape validated
// 2026-06-02 against /stop-predictions?stop_id=5012.
export const churtonParkBranchingBus: WireResponse = {
	closed: false,
	departures: [
		{
			stop_id: '5012',
			service_id: '1',
			trip_id: '1__2__301__TZM__301__301_20260601',
			destination: { stop_id: '3281', name: 'Churton Park' },
			trip_headsign: 'Churton Park',
			name: 'Lambton Central Stop A',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-06-02T18:05:00+12:00', expected: null },
			departure: { aimed: '2026-06-02T18:05:00+12:00', expected: null },
		},
		{
			stop_id: '5012',
			service_id: '1',
			trip_id: '1__2__345__TZM__345__345_20260601',
			destination: { stop_id: '3451', name: 'Grenada Vlg' },
			trip_headsign: 'Grenada Village',
			name: 'Lambton Central Stop A',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-06-02T18:09:00+12:00', expected: null },
			departure: { aimed: '2026-06-02T18:09:00+12:00', expected: null },
		},
		{
			stop_id: '5012',
			service_id: '1',
			trip_id: '1__2__304__TZM__304__304_20260601',
			destination: { stop_id: '3040', name: "J'ville West" },
			trip_headsign: 'Johnsonville West',
			name: 'Lambton Central Stop A',
			delay: 'PT0S',
			status: null,
			monitored: false,
			arrival: { aimed: '2026-06-02T18:14:00+12:00', expected: null },
			departure: { aimed: '2026-06-02T18:14:00+12:00', expected: null },
		},
	],
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
