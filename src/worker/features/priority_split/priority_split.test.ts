import { describe, it, expect } from 'vitest';
import { buildColumn, buildViewModel, toJsonView } from './viewmodel';
import type { ServiceColumn } from './viewmodel';
import { serviceName } from './service-name';
import type { TransitTarget } from '../../config/types';
import type { Arrival, StopState } from '../../gateways/metlink/metlink';

// Tested one layer below the public render() because the BMP pipeline
// (Satori → resvg → BMP) is blocked inside the workers-pool sandbox per
// ADR-0005; the raster path is exercised end-to-end via `pnpm dev` + curl.

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

// buildColumn returns a discriminated union; most assertions exercise the
// service column, so narrow once here and let tests read its fields directly.
function serviceColumn(
	target: TransitTarget,
	state: StopState,
	tz: string,
	now: Date,
): ServiceColumn {
	const col = buildColumn(target, state, tz, now);
	if (col.kind !== 'service') {
		throw new Error(`expected a service column, got "${col.kind}"`);
	}
	return col;
}

describe('priority_split.buildColumn - Leave In', () => {
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

describe('priority_split.buildColumn - Leave By', () => {
	it('renders Leave By = arrival - time_to_stop as "BY hh:mm" (comfort buffer excluded)', () => {
		// predicted 19:42Z (07:42 NZ); leave_by = 07:42 − 5 = 07:37
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.leaveBy).toBe('BY 07:37');
	});
});

describe('priority_split.buildColumn - Arrives', () => {
	it('renders Arrives In + arrival time as "ARRIVES IN n MIN - hh:mm"', () => {
		// predicted 19:42Z = now + 12 min, 07:42 NZ
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.arrives).toBe('ARRIVES IN 12 MIN · 07:42');
	});
});

describe('priority_split.buildColumn - Next service', () => {
	it('renders the second catchable service as "NEXT hh:mm"', () => {
		const col = serviceColumn(
			busTarget,
			open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z', '635')),
			TZ,
			NOW,
		);
		expect(col.next).toBe('NEXT 07:54');
	});

	it('renders dash when no next service is available', () => {
		const col = serviceColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.next).toBe('—');
	});
});

describe('priority_split.buildViewModel - assembly', () => {
	it('renders the wall-clock header and one full-width column for a single transit target', () => {
		const vm = buildViewModel(
			[busTarget],
			[open(arrival('2026-05-22T19:42:00Z'))],
			TZ,
			NOW,
		);
		expect(vm.wallClock).toBe('07:30');
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

describe('priority_split.buildViewModel - two transit targets', () => {
	it('renders two independent columns under one shared wall-clock header', () => {
		const vm = buildViewModel(
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
		const vm = buildViewModel(
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
		const vm = buildViewModel(
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

describe('priority_split.buildColumn - Catchable selection', () => {
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

describe('priority_split.buildColumn - No-service state (#10)', () => {
	it('renders NO SERVICE with the next departure clock when an uncatchable bus is still ahead', () => {
		// 19:32Z: predicted 2 min out but leave_by 19:27Z < now → not catchable,
		// yet still the next bus physically departing → its clock surfaces.
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:32:00Z')), TZ, NOW);
		expect(col.kind).toBe('no_service');
		if (col.kind !== 'no_service') throw new Error('expected no_service');
		expect(col.serviceId).toBe('634'); // header falls back to the target's first service id
		expect(col.tripHeadsign).toBe('');
		expect(col.nextDeparture).toBe('07:32');
	});

	it('leaves the next departure empty (renderer omits the line) when the feed carries no upcoming bus', () => {
		// Only a past departure (19:25Z < now): nothing ahead to show.
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:25:00Z')), TZ, NOW);
		expect(col.kind).toBe('no_service');
		if (col.kind !== 'no_service') throw new Error('expected no_service');
		expect(col.nextDeparture).toBe('');
	});

	it('leaves the next departure empty for an empty feed (route buried past the stop limit)', () => {
		const col = buildColumn(busTarget, open(), TZ, NOW);
		expect(col.kind).toBe('no_service');
		if (col.kind !== 'no_service') throw new Error('expected no_service');
		expect(col.nextDeparture).toBe('');
	});
});

describe('priority_split.buildColumn - Closed stop / gateway error', () => {
	it('degrades to dashes (distinct from NO SERVICE) when the stop is closed', () => {
		const col = buildColumn(busTarget, { kind: 'closed' }, TZ, NOW);
		expect(col.kind).toBe('service');
		if (col.kind !== 'service') throw new Error('expected service');
		expect(col.serviceId).toBe('634'); // fallback to the target's first service id
		expect(col.leaveIn).toBe('—');
		expect(col.next).toBe('—');
	});
});

describe('priority_split.toJsonView - serialisation', () => {
	it('maps a service column to snake_case wire fields verbatim', () => {
		const vm = buildViewModel(
			[busTarget],
			[open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z', '635'))],
			TZ,
			NOW,
		);

		expect(toJsonView(vm)).toEqual({
			wall_clock: '07:30',
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
		const vm = buildViewModel([busTarget], [open()], TZ, NOW);

		expect(toJsonView(vm)).toEqual({
			wall_clock: '07:30',
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

describe('priority_split.buildColumn - Marker', () => {
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
