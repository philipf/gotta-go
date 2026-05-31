// End-to-end tests for the Metlink gateway. Drives fetchArrivals through a
// stub fetch that returns a real Response constructed from fixtures.ts.
// Per ADR-0005 testing posture, integration-style through the public
// interface; no live HTTP calls.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArrivals } from './metlink';
import {
	closedStop,
	delayedTrain,
	multiRouteBus,
	originStop,
	scheduledTrain,
	schoolBusMultiRoute,
} from './fixtures';

afterEach(() => {
	vi.restoreAllMocks();
});

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

	it('array serviceId returns departures for all matched routes and excludes others', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(schoolBusMultiRoute), { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: '3234',
			serviceId: ['634', '635'],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.kind).toBe('open');
		if (result.data.kind !== 'open') return;
		expect(result.data.arrivals.map((a) => a.serviceId)).toEqual(['634', '635']);
	});

	it('surfaces a malformed JSON body on a 2xx as upstream with the actual status', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response('not even close to JSON', { status: 200 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result).toEqual({ ok: false, error: { kind: 'upstream', status: 200 } });
	});

	it('surfaces a thrown fetch (network failure) as { kind: "network" }', async () => {
		const stubFetch: typeof fetch = async () => {
			throw new TypeError('connection refused');
		};

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result).toEqual({ ok: false, error: { kind: 'network' } });
	});

	it('surfaces other non-2xx as upstream with a body snippet in detail, without logging (#55)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stubFetch: typeof fetch = async () =>
			new Response('upstream exploded', { status: 500 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		// Body is now carried back in detail for the caller to log — the gateway
		// itself no longer touches console (side-effect-free bulkhead, ADR-0005).
		expect(result).toEqual({
			ok: false,
			error: { kind: 'upstream', status: 500, detail: 'upstream exploded' },
		});
		expect(error).not.toHaveBeenCalled();
	});

	it('truncates an oversized upstream body to the 2 KB snippet cap in detail', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response('x'.repeat(3000), { status: 502 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result.ok).toBe(false);
		if (result.ok || result.error.kind !== 'upstream') throw new Error('expected upstream');
		expect(result.error.detail).toBe('x'.repeat(2048));
	});

	it('surfaces a 4xx (other than 401/403/429) as client_error, distinct from upstream', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response('{"message":"Stop not found"}', { status: 404 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: '9999',
			serviceId: 'KPL',
		});

		expect(result).toEqual({
			ok: false,
			error: { kind: 'client_error', status: 404, detail: '{"message":"Stop not found"}' },
		});
	});

	it('surfaces HTTP 429 as rate_limited with status + body detail', async () => {
		const stubFetch: typeof fetch = async () => new Response('Too Many Requests', { status: 429 });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'test-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result).toEqual({
			ok: false,
			error: { kind: 'rate_limited', status: 429, detail: 'Too Many Requests' },
		});
	});

	it('builds the request URL + x-api-key header and omits service_id from the query', async () => {
		let capturedUrl: string | undefined;
		let capturedHeaders: Headers | undefined;
		const stubFetch: typeof fetch = async (input, init) => {
			capturedUrl = typeof input === 'string' ? input : input.toString();
			capturedHeaders = new Headers(init?.headers);
			return new Response(JSON.stringify(closedStop), { status: 200 });
		};

		await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'secret-key-abc',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(capturedUrl).toBe(
			'https://api.opendata.metlink.org.nz/v1/stop-predictions?stop_id=TAKA1&limit=5',
		);
		expect(capturedHeaders?.get('x-api-key')).toBe('secret-key-abc');
		expect(capturedUrl).not.toContain('service_id');
	});

	it.each([401, 403])('surfaces HTTP %i as auth with status + body detail', async (status) => {
		const stubFetch: typeof fetch = async () =>
			new Response('{"message":"Forbidden"}', { status });

		const result = await fetchArrivals({
			fetch: stubFetch,
			apiKey: 'wrong-key',
			stopId: 'TAKA1',
			serviceId: 'KPL',
		});

		expect(result).toEqual({
			ok: false,
			error: { kind: 'auth', status, detail: '{"message":"Forbidden"}' },
		});
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
