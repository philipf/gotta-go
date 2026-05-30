import { describe, it, expect } from 'vitest';
import { buildColumn, buildViewModel, toJsonView } from './viewmodel';
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

describe('priority_split.buildColumn - Leave In', () => {
	it('renders Leave In = arrival - time_to_stop - now as "n MIN"', () => {
		// predicted 19:42Z = now + 12 min; leave_in = 12 − 5 = 7
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.leaveIn).toBe('7 MIN');
	});

	it('renders the literal NOW when Leave In reaches zero', () => {
		// predicted 19:35Z = now + 5 min; leave_by = now, leave_in = 5 − 5 = 0 → NOW
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:35:00Z')), TZ, NOW);
		expect(col.leaveIn).toBe('NOW');
	});
});

describe('priority_split.buildColumn - Leave By', () => {
	it('renders Leave By = arrival - time_to_stop as "BY hh:mm" (comfort buffer excluded)', () => {
		// predicted 19:42Z (07:42 NZ); leave_by = 07:42 − 5 = 07:37
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.leaveBy).toBe('BY 07:37');
	});
});

describe('priority_split.buildColumn - Arrives', () => {
	it('renders Arrives In + arrival time as "ARRIVES n MIN - hh:mm"', () => {
		// predicted 19:42Z = now + 12 min, 07:42 NZ
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
		expect(col.arrives).toBe('ARRIVES 12 MIN · 07:42');
	});
});

describe('priority_split.buildColumn - Next service', () => {
	it('renders the second catchable service as "NEXT hh:mm"', () => {
		const col = buildColumn(
			busTarget,
			open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z', '635')),
			TZ,
			NOW,
		);
		expect(col.next).toBe('NEXT 07:54');
	});

	it('renders dash when no next service is available', () => {
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
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
		expect(vm.columns[0].leaveIn).toBe('7 MIN');
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

		// Bus column: leave_in = (12 − 5) = 7, mode bus, route from selected service.
		expect(vm.columns[0].mode).toBe('bus');
		expect(vm.columns[0].routeCode).toBe('1');
		expect(vm.columns[0].leaveIn).toBe('7 MIN');

		// Train column computes from *its own* time_to_stop (15): predicted 20:00Z =
		// now + 30 min, leave_in = 30 − 15 = 15. Independent of the bus column.
		expect(vm.columns[1].mode).toBe('train');
		expect(vm.columns[1].routeCode).toBe('KPL');
		expect(vm.columns[1].leaveIn).toBe('15 MIN');
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
});

describe('priority_split.buildColumn - Catchable selection', () => {
	it('skips a missed service (leave_by already passed) and selects the earliest catchable one', () => {
		// 19:32Z: leave_by 19:27Z < now → missed. 19:48Z: leave_by 19:43Z ≥ now → catchable.
		const col = buildColumn(
			busTarget,
			open(arrival('2026-05-22T19:32:00Z', '634'), arrival('2026-05-22T19:48:00Z', '635')),
			TZ,
			NOW,
		);
		// leave_in for the catchable one = (18 − 5) = 13
		expect(col.leaveIn).toBe('13 MIN');
		// route code comes from the *selected* service, resolving the any-of array
		expect(col.routeCode).toBe('635');
	});
});

describe('priority_split.toJsonView - serialisation', () => {
	it('maps the rendered view model to snake_case wire fields verbatim', () => {
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
					mode: 'bus',
					route_code: '634',
					leave_in: '7 MIN',
					leave_by: 'BY 07:37',
					arrives: 'ARRIVES 12 MIN · 07:42',
					next: 'NEXT 07:54',
					marker_ratio: vm.columns[0].markerRatio,
				},
			],
		});
	});
});

describe('priority_split.buildColumn - Marker', () => {
	it('sits hard-right (ratio 1) when leave margin is zero (Now)', () => {
		// leave_by = now → margin 0 → ratio 1
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:35:00Z')), TZ, NOW);
		expect(col.markerRatio).toBe(1);
	});

	it('sits hard-left (ratio 0) when leave margin >= one full window', () => {
		// window = time_to_stop(5) × comfort_buffer(3) = 15 min.
		// predicted 20:05Z = now + 35 min; leave_by = now + 30 → margin 30 ≥ 15 → ratio 0
		const col = buildColumn(busTarget, open(arrival('2026-05-22T20:05:00Z')), TZ, NOW);
		expect(col.markerRatio).toBe(0);
	});

	it('interpolates ratio = 1 - leave_margin/window inside the window', () => {
		// predicted 19:50Z = now + 20 min; leave_by = now + 15... wait recompute:
		// leave_by = predicted − 5 = now + 15? No: now+20−5 = now+15 → margin 15.
		// Use predicted 19:47:30Z = now + 17.5; leave_by = now + 12.5; margin 12.5;
		// window 15 → ratio = 1 − 12.5/15 = 0.1666…
		const col = buildColumn(busTarget, open(arrival('2026-05-22T19:47:30Z')), TZ, NOW);
		expect(col.markerRatio).toBeCloseTo(1 - 12.5 / 15, 5);
	});
});
