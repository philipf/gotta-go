import { describe, it, expect } from 'vitest';
import { toJsonView, serviceName, type ServiceColumn } from './viewmodel';
import { viewModelFromStopStates } from './domain-service';
import {
  preparePrioritySplitV2Frame,
  type ArrivalsSource,
  type PreparePrioritySplitV2FrameRequest,
} from './prepare-priority-split-v2-frame';
import type { TransitTarget } from '../../config/config-types';
import type { Arrival, StopState, MetlinkGatewayError } from '../../gateways/metlink/fetch-arrivals';
import { type AppError, FatalError, RetryableError } from '../../shared/errors';

// The NEXT/THEN slot computation is specified against gateway StopStates through
// the viewModelFromStopStates seam (see domain-service.ts) — driving it through
// the public capability would drag Metlink wire payloads into this folder
// (ADR-0005 quarantine). The fetch + error-mapping path is driven through the
// public preparePrioritySplitV2Frame (last describe block); the raster path
// (Satori → resvg → BMP) is sandbox-blocked per ADR-0005 and exercised via
// `pnpm dev` + curl.

const TZ = 'Pacific/Auckland';
// 2026-05-22T19:30:00Z = 07:30 NZST (UTC+12).
const NOW = new Date('2026-05-22T19:30:00Z');

const busTarget: TransitTarget = {
  mode: 'bus',
  stopId: '3234',
  serviceId: '1',
  timeToStopMins: 5,
  comfortBuffer: 1.5,
};

const trainTarget: TransitTarget = {
  mode: 'train',
  stopId: 'TAKA1',
  serviceId: 'KPL',
  timeToStopMins: 15,
  comfortBuffer: 1.5,
};

function arrival(predictedIso: string, serviceId = '1'): Arrival {
  const predicted = new Date(predictedIso);
  return {
    serviceId,
    tripHeadsign: 'Island Bay',
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

// The single-target column under test.
function column(target: TransitTarget, state: StopState, tz: string, now: Date): ServiceColumn {
  return viewModelFromStopStates([target], [state], tz, now).columns[0];
}

describe('priority_split_v2.column - NEXT slot', () => {
  it('renders Leave In = arrival - time_to_stop - now as "n MIN"', () => {
    // predicted 19:42Z = now + 12 min; leave_in = 12 − 5 = 7
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('7 MIN');
  });

  it('renders the literal NOW when Leave In reaches zero', () => {
    // predicted 19:35Z = now + 5 min; leave_by = now, leave_in = 5 − 5 = 0 → NOW
    const col = column(busTarget, open(arrival('2026-05-22T19:35:00Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('NOW');
  });

  it('carries Leave By and the arrival clock (no "ARRIVES IN n MIN")', () => {
    // predicted 19:42Z (07:42); leave_by = 07:42 − 5 = 07:37
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.next?.leaveBy).toBe('BY 07:37');
    expect(col.next?.arrives).toBe('ARR 07:42');
  });

  it('names the column after the NEXT departure (service + headsign)', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1')), TZ, NOW);
    expect(col.serviceId).toBe('1');
    expect(col.tripHeadsign).toBe('Island Bay');
  });
});

describe('priority_split_v2.column - THEN slot', () => {
  it('projects the second upcoming departure into THEN', () => {
    // NEXT 19:42 (leave_in 7); THEN 19:54 = now + 24, leave_in = 24 − 5 = 19
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('7 MIN');
    expect(col.then?.leaveIn).toBe('19 MIN');
    expect(col.then?.leaveBy).toBe('BY 07:49');
    expect(col.then?.arrives).toBe('ARR 07:54');
  });

  it('is null when only one departure is upcoming', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.next).not.toBeNull();
    expect(col.then).toBeNull();
  });

  it('shows "0 MIN" (never NOW) when a THEN departure rounds to zero — NOW is the NEXT slot only', () => {
    // NEXT 19:35:00 (+5, leave_in 0 → NOW); THEN 19:35:12 (+5.2, leave_in round(0.2) = 0 → "0 MIN")
    const col = column(busTarget, open(arrival('2026-05-22T19:35:00Z'), arrival('2026-05-22T19:35:12Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('NOW');
    expect(col.then?.leaveIn).toBe('0 MIN');
  });
});

describe('priority_split_v2.column - upcoming selection', () => {
  it('drops a missed departure (leave_by already passed) and starts NEXT at the earliest catchable one', () => {
    // 19:32Z: leave_by 19:27Z < now → missed. 19:48Z: leave_by 19:43Z ≥ now → upcoming.
    const col = column(busTarget, open(arrival('2026-05-22T19:32:00Z', '1'), arrival('2026-05-22T19:48:00Z', '1')), TZ, NOW);
    // leave_in for the first catchable = (18 − 5) = 13; nothing after it → THEN null
    expect(col.next?.leaveIn).toBe('13 MIN');
    expect(col.then).toBeNull();
  });

  it('sorts chronologically so NEXT is the soonest regardless of feed order', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:54:00Z'), arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.next?.arrives).toBe('ARR 07:42');
    expect(col.then?.arrives).toBe('ARR 07:54');
  });
});

describe('priority_split_v2.column - closed stop', () => {
  it('dashes both slots (no upcoming) and keeps the configured route id in the header', () => {
    const col = column(busTarget, { kind: 'closed' }, TZ, NOW);
    expect(col.serviceId).toBe('1'); // fallback to the target's first service id
    expect(col.tripHeadsign).toBe('');
    expect(col.next).toBeNull();
    expect(col.then).toBeNull();
  });

  it('resolves the any-of array to its first id for the header fallback', () => {
    const arrayTarget: TransitTarget = { ...busTarget, serviceId: ['634', '635'] };
    const col = column(arrayTarget, { kind: 'closed' }, TZ, NOW);
    expect(col.serviceId).toBe('634');
  });
});

describe('priority_split_v2.viewModelFromStopStates - assembly', () => {
  it('renders the wall-clock header and one full-width column for a single transit target', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T19:42:00Z'))], TZ, NOW);
    expect(vm.wallClock).toBe('07:30');
    expect(vm.date).toBe('Sat 23 May');
    expect(vm.columns).toHaveLength(1);
    expect(vm.columns[0].next?.leaveIn).toBe('7 MIN');
  });

  it('renders two independent columns under one shared wall-clock header', () => {
    const vm = viewModelFromStopStates(
      [busTarget, trainTarget],
      [open(arrival('2026-05-22T19:42:00Z', '1')), open(arrival('2026-05-22T20:00:00Z', 'KPL'))],
      TZ,
      NOW,
    );

    expect(vm.columns).toHaveLength(2);

    // Bus column: leave_in = (12 − 5) = 7, mode bus, service id from NEXT.
    expect(vm.columns[0].mode).toBe('bus');
    expect(vm.columns[0].serviceId).toBe('1');
    expect(vm.columns[0].next?.leaveIn).toBe('7 MIN');

    // Train column computes from *its own* time_to_stop (15): predicted 20:00Z =
    // now + 30 min, leave_in = 30 − 15 = 15. Independent of the bus column.
    expect(vm.columns[1].mode).toBe('train');
    expect(vm.columns[1].serviceId).toBe('KPL');
    expect(vm.columns[1].next?.leaveIn).toBe('15 MIN');
  });
});

describe('priority_split_v2.toJsonView - serialisation', () => {
  it('maps a column to snake_case wire fields, nesting the NEXT/THEN slots', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z'))], TZ, NOW);

    expect(toJsonView(vm)).toEqual({
      wall_clock: '07:30',
      date: 'Sat 23 May',
      columns: [
        {
          mode: 'bus',
          service_id: '1',
          trip_headsign: 'Island Bay',
          next: { leave_in: '7 MIN', leave_by: 'BY 07:37', arrives: 'ARR 07:42' },
          then: { leave_in: '19 MIN', leave_by: 'BY 07:49', arrives: 'ARR 07:54' },
        },
      ],
    });
  });

  it('serialises an absent THEN slot as null', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T19:42:00Z'))], TZ, NOW);
    const json = toJsonView(vm) as { columns: { then: unknown }[] };
    expect(json.columns[0].then).toBeNull();
  });
});

describe('priority_split_v2.serviceName - column-header label', () => {
  it('joins service id and headsign with a padded middot separator', () => {
    expect(serviceName('1', 'Island Bay')).toBe('1 · Island Bay');
  });

  it('shows the service id alone (no dangling separator) when the headsign is empty', () => {
    expect(serviceName('634', '')).toBe('634');
  });
});

// Drives the public capability through a domain-typed ArrivalsSource so the
// sandbox-blocked BMP pipeline is never reached while the caller's error policy
// runs for real. Asserts the #59 policy: a gateway error short-circuits the
// frame by throwing the mapped problem type rather than degrading silently.
describe('priority_split_v2.preparePrioritySplitV2Frame - gateway failure -> throws problem type (#59)', () => {
  const failingSource =
    (error: MetlinkGatewayError): ArrivalsSource =>
    async () => ({ ok: false, error });

  const succeedingSource =
    (data: StopState): ArrivalsSource =>
    async () => ({ ok: true, data });

  function requestWith(fetchArrivals: ArrivalsSource): PreparePrioritySplitV2FrameRequest {
    return {
      targets: [busTarget],
      fetchArrivals,
      timezone: TZ,
      now: NOW,
      includeBmp: false,
      includeSvg: false,
    };
  }

  async function prepareError(fetchArrivals: ArrivalsSource): Promise<AppError> {
    try {
      await preparePrioritySplitV2Frame(requestWith(fetchArrivals));
    } catch (e) {
      return e as AppError;
    }
    throw new Error('expected preparePrioritySplitV2Frame() to throw');
  }

  it('throws a Fatal metlink-auth on a gateway auth error', async () => {
    const err = await prepareError(failingSource({ kind: 'auth', status: 401, detail: 'Unauthorized' }));
    expect(err).toBeInstanceOf(FatalError);
    expect(err.slug).toBe('metlink-auth');
    expect(err.upstreamDetail).toBe('Unauthorized');
  });

  it('throws a Retryable metlink-unavailable on an upstream 5xx error', async () => {
    const err = await prepareError(failingSource({ kind: 'upstream', status: 500, detail: 'nope' }));
    expect(err).toBeInstanceOf(RetryableError);
    expect(err.slug).toBe('metlink-unavailable');
  });

  it('still builds a normal view model for a legitimate closed/empty-feed stop (no throw)', async () => {
    const prepared = await preparePrioritySplitV2Frame(requestWith(succeedingSource({ kind: 'closed' })));
    expect((prepared.view as { columns: unknown[] }).columns).toHaveLength(1);
  });
});
