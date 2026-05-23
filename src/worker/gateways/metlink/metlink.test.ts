// End-to-end tests for the Metlink gateway. Drives fetchArrivals through a
// stub fetch that returns a real Response constructed from fixtures.ts.
// Per ADR-0005 testing posture, integration-style through the public
// interface; no live HTTP calls.

import { describe, it, expect } from 'vitest';
import { fetchArrivals } from './metlink';
import {
	closedStop,
	delayedTrain,
	multiRouteBus,
	originStop,
	scheduledTrain,
} from './fixtures';

describe('fetchArrivals', () => {
	it('surfaces a closed:true envelope as { kind: "closed" }', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(closedStop), { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result).toEqual({ ok: true, data: { kind: 'closed' } });
	});

	it('maps a scheduled-only departure into an Arrival with predicted === scheduled', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(scheduledTrain), { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		const scheduled = new Date('2026-05-23T06:48:00+12:00');
		expect(result).toEqual({
			ok: true,
			data: {
				kind: 'open',
				arrivals: [
					{
						serviceId: 'KPL',
						tripHeadsign: 'Wellington Station',
						name: 'TakapuRdStn',
						scheduled,
						predicted: scheduled,
						delaySeconds: 0,
						status: 'scheduled',
						tripId: 'KPL__1__6407__RAIL__Rail_Sa_20260419',
					},
				],
			},
		});
	});

	it('maps a delayed departure with delaySeconds, status, and predicted from arrival.expected', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(delayedTrain), { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result).toEqual({
			ok: true,
			data: {
				kind: 'open',
				arrivals: [
					{
						serviceId: 'KPL',
						tripHeadsign: 'Wellington Station',
						name: 'TakapuRdStn',
						scheduled: new Date('2026-05-23T05:48:00+12:00'),
						predicted: new Date('2026-05-23T05:54:12+12:00'),
						delaySeconds: 372,
						status: 'delayed',
						tripId: 'KPL__1__6407__RAIL__Rail_Sa_20260419',
					},
				],
			},
		});
	});

	it('filters multi-route stop responses to the requested service_id', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(multiRouteBus), { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: '3234',
			serviceId: '1',
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.kind).toBe('open');
		if (result.data.kind !== 'open') return;
		expect(result.data.arrivals.map((a) => a.serviceId)).toEqual(['1']);
		expect(result.data.arrivals[0].tripHeadsign).toBe('Island Bay');
	});

	it('falls back to departure.aimed when arrival.aimed is absent at origin stops', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(originStop), { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: '6001',
			serviceId: '17',
		});

		expect(result.ok).toBe(true);
		if (!result.ok || result.data.kind !== 'open') return;
		const [arrival] = result.data.arrivals;
		const expected = new Date('2026-05-23T07:00:00+12:00');
		expect(arrival.scheduled).toEqual(expected);
		expect(arrival.predicted).toEqual(expected);
	});
});
