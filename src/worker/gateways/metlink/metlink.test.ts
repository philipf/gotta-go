// End-to-end tests for the Metlink gateway. Drives fetchArrivals through a
// stub fetch that returns a real Response constructed from fixtures.ts.
// Per ADR-0005 testing posture, integration-style through the public
// interface; no live HTTP calls.

import { describe, it, expect } from 'vitest';
import { fetchArrivals } from './metlink';
import { closedStop, scheduledTrain } from './fixtures';

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
});
