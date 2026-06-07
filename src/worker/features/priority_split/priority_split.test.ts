import { describe, it, expect } from 'vitest';
import { toJsonView, type ColumnViewModel, type ServiceColumn } from './viewmodel';
import { layout, viewModelFromStopStates, type PrioritySplitContext } from './service';
import { serviceName } from './service-name';
import type { TransitTarget } from '../../config/types';
import type { Arrival, StopState } from '../../gateways/metlink/metlink';
import { type AppError, FatalError, RetryableError } from '../../shared/errors';

// Column/marker behaviour is specified against gateway StopStates through the
// viewModelFromStopStates seam (see the service.ts header): driving those
// cases through layout.buildViewModel would drag Metlink wire payloads into
// this folder (ADR-0005 quarantine). The fetch + error-mapping path *is*
// driven through the public layout.buildViewModel (last describe block); the
// raster path (Satori → resvg → BMP) is sandbox-blocked per ADR-0005 and
// exercised via `pnpm dev` + curl.

const TZ = 'Pacific/Auckland';
// 2026-05-22T19:30:00Z = 07:30 NZST (UTC+12).
const NOW = new Date('2026-05-22T19:30:00Z');

const busTarget: TransitTarget = {
	mode: 'bus',
	stopId: '3234',
	serviceId: ['634', '635'],
	timeToStopMins: 5,
	comfortBuffer: 3,
};

function arrival(predictedIso: string, serviceId = '634'): Arrival {
	const predicted = new Date(predictedIso);
	return {
		serviceId,
		tripHeadsign: 'Newlands',
		name: '',
		scheduled: predicted,
		predicted,
		delaySeconds: 0,
		status: 'scheduled',
		tripId: `trip-${predictedIso}`,
	};
}

function open(...arrivals: Arrival[]): StopState {
	return { kind: 'open', arrivals };
}

// The view model for a single target/state pair — the per-column unit the
// behaviour tests assert on.
function column(target: TransitTarget, state: StopState, tz: string, now: Date): ColumnViewModel {
	return viewModelFromStopStates([target], [state], tz, now).columns[0];
}

// Columns form a discriminated union; most assertions exercise the service
// column, so narrow once here and let tests read its fields directly.
function serviceColumn(
	target: TransitTarget,
	state: StopState,
	tz: string,
	now: Date,
): ServiceColumn {
	const col = column(target, state, tz, now);
	if (col.kind !== 'service') {
		throw new Error(`expected a service column, got "${col.kind}"`);
	}
	return col;
}

describe('priority_split.column - Leave In', () => {
	it('renders Leave In = arrival - time_to_stop - now as "n MIN"', () => {
		// predicted 19:42Z = now + 12 min; leave_in = 12 − 5 = 7
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.leaveIn).toBe('7 MIN');
	});

	it('renders the literal NOW when Leave In reaches zero', () => {
		// predicted 19:35Z = now + 5 min; leave_by = now, leave_in = 5 − 5 = 0 → NOW
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:35:00Z')), TZ, NOW);
		expect(col.leaveIn).toBe('NOW');
	});
});

describe('priority_split.column - Leave By', () => {
	it('renders Leave By = arrival - time_to_stop as "BY hh:mm" (comfort buffer excluded)', () => {
		// predicted 19:42Z (07:42 NZ); leave_by = 07:42 − 5 = 07:37
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.leaveBy).toBe('BY 07:37');
	});
});

describe('priority_split.column - Arrives', () => {
	it('renders Arrives In + arrival time as "ARRIVES IN n MIN - hh:mm"', () => {
		// predicted 19:42Z = now + 12 min, 07:42 NZ
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.arrives).toBe('ARRIVES IN 12 MIN · 07:42');
	});
});

describe('priority_split.column - Next services (the three after the hero)', () => {
	it('chains the three services after the hero with an arrow separator (NEXT a -> b -> c)', () => {
		// Hero = 19:42 (07:42); the next three catchable = 07:54, 08:06, 08:18.
		const col = serviceColumn(
			busTarget,
			open(
				arrival('2026-05-22T19:42:00Z'),
				arrival('2026-05-22T19:54:00Z', '635'),
				arrival('2026-05-22T20:06:00Z'),
				arrival('2026-05-22T20:18:00Z', '635'),
			),
			TZ,
			NOW,
		);
		expect(col.next).toBe('NEXT 07:54 → 08:06 → 08:18');
	});

	it('caps the chain at three even when more services are catchable', () => {
		// Hero + five more; only the first three after the hero are shown.
		const col = serviceColumn(
			busTarget,
			open(
				arrival('2026-05-22T19:42:00Z'),
				arrival('2026-05-22T19:54:00Z'),
				arrival('2026-05-22T20:06:00Z'),
				arrival('2026-05-22T20:18:00Z'),
				arrival('2026-05-22T20:30:00Z'),
				arrival('2026-05-22T20:42:00Z'),
			),
			TZ,
			NOW,
		);
		expect(col.next).toBe('NEXT 07:54 → 08:06 → 08:18');
	});

	it('renders only the services that exist (no dash padding) - two after the hero', () => {
		const col = serviceColumn(
			busTarget,
			open(
				arrival('2026-05-22T19:42:00Z'),
				arrival('2026-05-22T19:54:00Z', '635'),
				arrival('2026-05-22T20:06:00Z'),
			),
			TZ,
			NOW,
		);
		expect(col.next).toBe('NEXT 07:54 → 08:06');
	});

	it('renders the single service after the hero as "NEXT hh:mm" (no separator)', () => {
		const col = serviceColumn(
			busTarget,
			open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z', '635')),
			TZ,
			NOW,
		);
		expect(col.next).toBe('NEXT 07:54');
	});

	it('renders dash when no service follows the hero', () => {
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.next).toBe('—');
	});
});

describe('priority_split.viewModelFromStopStates - assembly', () => {
	it('renders the wall-clock header and one full-width column for a single transit target', () => {
		const vm = viewModelFromStopStates(
			[busTarget],
			[open(arrival('2026-05-22T19:42:00Z'))],
			TZ,
			NOW,
		);
		expect(vm.wallClock).toBe('07:30');
		expect(vm.date).toBe('Sat 23 May');
		expect(vm.columns).toHaveLength(1);
		const col = vm.columns[0];
		expect(col.kind).toBe('service');
		expect((col as ServiceColumn).leaveIn).toBe('7 MIN');
	});
});

const trainTarget: TransitTarget = {
	mode: 'train',
	stopId: 'TAKA1',
	serviceId: 'KPL',
	timeToStopMins: 15,
	comfortBuffer: 4,
};

describe('priority_split.viewModelFromStopStates - two transit targets', () => {
	it('renders two independent columns under one shared wall-clock header', () => {
		const vm = viewModelFromStopStates(
			[busTarget, trainTarget],
			[
				open(arrival('2026-05-22T19:42:00Z', '1')),
				open(arrival('2026-05-22T20:00:00Z', 'KPL')),
			],
			TZ,
			NOW,
		);

		expect(vm.wallClock).toBe('07:30');
		expect(vm.columns).toHaveLength(2);

		// Bus column: leave_in = (12 − 5) = 7, mode bus, service id from selected service.
		const bus = vm.columns[0] as ServiceColumn;
		expect(bus.mode).toBe('bus');
		expect(bus.serviceId).toBe('1');
		expect(bus.tripHeadsign).toBe('Newlands');
		expect(bus.leaveIn).toBe('7 MIN');

		// Train column computes from *its own* time_to_stop (15): predicted 20:00Z =
		// now + 30 min, leave_in = 30 − 15 = 15. Independent of the bus column.
		const train = vm.columns[1] as ServiceColumn;
		expect(train.mode).toBe('train');
		expect(train.serviceId).toBe('KPL');
		expect(train.leaveIn).toBe('15 MIN');
	});

	it('serialises both columns in order via toJsonView', () => {
		const vm = viewModelFromStopStates(
			[busTarget, trainTarget],
			[
				open(arrival('2026-05-22T19:42:00Z', '1')),
				open(arrival('2026-05-22T20:00:00Z', 'KPL')),
			],
			TZ,
			NOW,
		);

		const json = toJsonView(vm) as { columns: { mode: string }[] };
		expect(json.columns).toHaveLength(2);
		expect(json.columns[0].mode).toBe('bus');
		expect(json.columns[1].mode).toBe('train');
	});

	it('leaves the other column unaffected when one target has no service (#10)', () => {
		const vm = viewModelFromStopStates(
			[busTarget, trainTarget],
			[
				open(), // bus: empty feed → no-service
				open(arrival('2026-05-22T20:00:00Z', 'KPL')), // train: catchable
			],
			TZ,
			NOW,
		);

		expect(vm.columns[0].kind).toBe('no_service');
		expect(vm.columns[1].kind).toBe('service');
		expect((vm.columns[1] as ServiceColumn).leaveIn).toBe('15 MIN');
	});
});

describe('priority_split.column - Catchable selection', () => {
	it('skips a missed service (leave_by already passed) and selects the earliest catchable one', () => {
		// 19:32Z: leave_by 19:27Z < now → missed. 19:48Z: leave_by 19:43Z ≥ now → catchable.
		const col = serviceColumn(
			busTarget,
			open(arrival('2026-05-22T19:32:00Z', '634'), arrival('2026-05-22T19:48:00Z', '635')),
			TZ,
			NOW,
		);
		// leave_in for the catchable one = (18 − 5) = 13
		expect(col.leaveIn).toBe('13 MIN');
		// service id comes from the *selected* service, resolving the any-of array
		expect(col.serviceId).toBe('635');
	});
});

describe('priority_split.column - No-service state (#10)', () => {
	it('renders NO SERVICE with the next departure clock when an uncatchable bus is still ahead', () => {
		// 19:32Z: predicted 2 min out but leave_by 19:27Z < now → not catchable,
		// yet still the next bus physically departing → its clock surfaces.
		const col = column(busTarget, open(arrival('2026-05-22T19:32:00Z')), TZ, NOW);
		expect(col.kind).toBe('no_service');
		if (col.kind !== 'no_service') throw new Error('expected no_service');
		expect(col.serviceId).toBe('634'); // header falls back to the target's first service id
		expect(col.tripHeadsign).toBe('');
		expect(col.nextDeparture).toBe('07:32');
	});

	it('leaves the next departure empty (renderer omits the line) when the feed carries no upcoming bus', () => {
		// Only a past departure (19:25Z < now): nothing ahead to show.
		const col = column(busTarget, open(arrival('2026-05-22T19:25:00Z')), TZ, NOW);
		expect(col.kind).toBe('no_service');
		if (col.kind !== 'no_service') throw new Error('expected no_service');
		expect(col.nextDeparture).toBe('');
	});

	it('leaves the next departure empty for an empty feed (route buried past the stop limit)', () => {
		const col = column(busTarget, open(), TZ, NOW);
		expect(col.kind).toBe('no_service');
		if (col.kind !== 'no_service') throw new Error('expected no_service');
		expect(col.nextDeparture).toBe('');
	});
});

describe('priority_split.column - Closed stop / gateway error', () => {
	it('degrades to dashes (distinct from NO SERVICE) when the stop is closed', () => {
		const col = column(busTarget, { kind: 'closed' }, TZ, NOW);
		expect(col.kind).toBe('service');
		if (col.kind !== 'service') throw new Error('expected service');
		expect(col.serviceId).toBe('634'); // fallback to the target's first service id
		expect(col.leaveIn).toBe('—');
		expect(col.next).toBe('—');
	});
});

describe('priority_split.toJsonView - serialisation', () => {
	it('maps a service column to snake_case wire fields verbatim', () => {
		const vm = viewModelFromStopStates(
			[busTarget],
			[open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z', '635'))],
			TZ,
			NOW,
		);

		expect(toJsonView(vm)).toEqual({
			wall_clock: '07:30',
			date: 'Sat 23 May',
			columns: [
				{
					kind: 'service',
					mode: 'bus',
					service_id: '634',
					trip_headsign: 'Newlands',
					leave_in: '7 MIN',
					leave_by: 'BY 07:37',
					arrives: 'ARRIVES IN 12 MIN · 07:42',
					next: 'NEXT 07:54',
					marker_ratio: (vm.columns[0] as ServiceColumn).markerRatio,
				},
			],
		});
	});

	it('maps a no-service column to its own wire shape (no tier/marker fields)', () => {
		const vm = viewModelFromStopStates([busTarget], [open()], TZ, NOW);

		expect(toJsonView(vm)).toEqual({
			wall_clock: '07:30',
			date: 'Sat 23 May',
			columns: [
				{
					kind: 'no_service',
					mode: 'bus',
					service_id: '634',
					trip_headsign: '',
					next_departure: '',
				},
			],
		});
	});
});

describe('priority_split.serviceName - column-header label', () => {
	it('joins service id and headsign with a padded middot separator', () => {
		expect(serviceName('1', 'Island Bay')).toBe('1 · Island Bay');
	});

	it('shows the service id alone (no dangling separator) when the headsign is empty', () => {
		expect(serviceName('634', '')).toBe('634');
	});
});

describe('priority_split.column - Marker', () => {
	it('sits hard-right (ratio 1) when leave margin is zero (Now)', () => {
		// leave_by = now → margin 0 → ratio 1
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:35:00Z')), TZ, NOW);
		expect(col.markerRatio).toBe(1);
	});

	it('sits hard-left (ratio 0) when leave margin >= one full window', () => {
		// window = time_to_stop(5) × comfort_buffer(3) = 15 min.
		// predicted 20:05Z = now + 35 min; leave_by = now + 30 → margin 30 ≥ 15 → ratio 0
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T20:05:00Z')), TZ, NOW);
		expect(col.markerRatio).toBe(0);
	});

	it('interpolates ratio = 1 - leave_margin/window inside the window', () => {
		// predicted 19:50Z = now + 20 min; leave_by = now + 15... wait recompute:
		// leave_by = predicted − 5 = now + 15? No: now+20−5 = now+15 → margin 15.
		// Use predicted 19:47:30Z = now + 17.5; leave_by = now + 12.5; margin 12.5;
		// window 15 → ratio = 1 − 12.5/15 = 0.1666…
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:47:30Z')), TZ, NOW);
		expect(col.markerRatio).toBeCloseTo(1 - 12.5 / 15, 5);
	});
});

// Drives the public buildViewModel phase (#72) through a stubbed fetch so the
// sandbox-blocked BMP pipeline is never reached while the gateway + caller
// error path runs for real. Asserts the #59 failure policy: a gateway error
// short-circuits the frame by throwing the mapped problem type (the
// renderFrame boundary, tested in router.test.ts, turns it into problem+json)
// rather than degrading silently to dashes.
describe('priority_split.layout.buildViewModel - gateway failure → throws problem type (#59)', () => {
	// PrioritySplitContext — the layout's declared RenderContext slice —
	// carries exactly the dependencies the layout consumes; METLINK_API_KEY is
	// typed directly, no Env cast.
	function ctxWith(fetchFn: typeof fetch): PrioritySplitContext {
		return {
			phase: {
				key: 'morning_commute',
				startTime: '07:00',
				endTime: '09:00',
				layout: 'priority_split',
				refreshIntervalMinutes: 5,
				transitTargets: [busTarget],
			},
			timezone: TZ,
			stopPredictionLimit: 5,
			now: NOW,
			format: 'json',
			includeBmp: false,
			env: { METLINK_API_KEY: 'test-key' },
			fetchFn,
		};
	}

	// Captures the AppError buildViewModel() throws, failing loudly if it
	// unexpectedly resolves — keeps the return type a clean AppError (not
	// AppError | ViewModel).
	async function buildError(ctx: PrioritySplitContext): Promise<AppError> {
		try {
			await layout.buildViewModel(ctx);
		} catch (e) {
			return e as AppError;
		}
		throw new Error('expected buildViewModel() to throw');
	}

	it('throws a Fatal metlink-auth on a Metlink 401, carrying the upstream snippet', async () => {
		const fetchFn: typeof fetch = async () => new Response('Unauthorized', { status: 401 });

		const err = await buildError(ctxWith(fetchFn));

		expect(err).toBeInstanceOf(FatalError);
		expect(err.slug).toBe('metlink-auth');
		expect(err.status).toBe(500);
		expect(err.logLevel).toBe('error');
		expect(err.upstreamDetail).toBe('Unauthorized');
	});

	it('throws a Fatal metlink-bad-request on a Metlink 4xx config fault, naming the stop', async () => {
		const fetchFn: typeof fetch = async () => new Response('{"message":"Stop not found"}', { status: 404 });

		const err = await buildError(ctxWith(fetchFn));

		expect(err).toBeInstanceOf(FatalError);
		expect(err.slug).toBe('metlink-bad-request');
		expect(err.detail).toContain('stop 3234');
	});

	it.each([
		[429, 'metlink-rate-limited'],
		[500, 'metlink-unavailable'],
	])('throws a Retryable %s problem on Metlink HTTP %i', async (status, slug) => {
		const fetchFn: typeof fetch = async () => new Response('nope', { status });

		const err = await buildError(ctxWith(fetchFn));

		expect(err).toBeInstanceOf(RetryableError);
		expect(err.slug).toBe(slug);
		expect(err.status).toBe(502);
		expect(err.logLevel).toBe('warn');
	});

	it('throws a Retryable metlink-unavailable on a network failure', async () => {
		const fetchFn: typeof fetch = async () => {
			throw new TypeError('connection refused');
		};

		const err = await buildError(ctxWith(fetchFn));

		expect(err).toBeInstanceOf(RetryableError);
		expect(err.slug).toBe('metlink-unavailable');
		expect(err.upstreamDetail).toBeUndefined();
	});

	it('still builds a normal view model for a legitimate closed/empty-feed stop (no throw)', async () => {
		const fetchFn: typeof fetch = async () =>
			new Response(JSON.stringify({ closed: true, departures: [] }), { status: 200 });

		const vm = await layout.buildViewModel(ctxWith(fetchFn));

		expect(vm.columns).toHaveLength(1);
	});
});
