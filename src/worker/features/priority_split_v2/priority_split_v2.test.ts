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

// `predicted` is the expected arrival the slots compute against; `delaySeconds`
// is the signed drift from the timetable that drives the DELAYED/EARLY badge
// (#105) — positive late, negative early, 0 on time.
function arrival(predictedIso: string, serviceId = '1', delaySeconds = 0): Arrival {
  const predicted = new Date(predictedIso);
  return {
    serviceId,
    tripHeadsign: 'Island Bay',
    name: '',
    scheduled: new Date(predicted.getTime() - delaySeconds * 1000),
    predicted,
    delaySeconds,
    status: delaySeconds > 0 ? 'delayed' : delaySeconds < 0 ? 'early' : 'scheduled',
    tripId: `trip-${predictedIso}`,
  };
}

// A cancelled departure: status 'cancelled', no schedule deviation. Its
// `scheduled` clock is what the renderer strikes through (#106). predicted =
// scheduled — a cancelled service carries no live prediction.
function cancelledArrival(scheduledIso: string, serviceId = '1'): Arrival {
  const scheduled = new Date(scheduledIso);
  return {
    serviceId,
    tripHeadsign: 'Island Bay',
    name: '',
    scheduled,
    predicted: scheduled,
    delaySeconds: 0,
    status: 'cancelled',
    tripId: `trip-${scheduledIso}`,
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
    // predicted 19:42Z = now + 12 min; leave_in = 12 - 5 = 7
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('7 MIN');
  });

  it('renders the literal NOW when Leave In reaches zero', () => {
    // predicted 19:35Z = now + 5 min; leave_by = now, leave_in = 5 - 5 = 0 → NOW
    const col = column(busTarget, open(arrival('2026-05-22T19:35:00Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('NOW');
  });

  it('carries Leave By and the arrival clock (no "ARRIVES IN n MIN")', () => {
    // predicted 19:42Z (07:42); leave_by = 07:42 - 5 = 07:37
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
    // NEXT 19:42 (leave_in 7); THEN 19:54 = now + 24, leave_in = 24 - 5 = 19
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

  it('shows "0 MIN" (never NOW) when a THEN departure rounds to zero - NOW is the NEXT slot only', () => {
    // NEXT 19:35:00 (+5, leave_in 0 → NOW); THEN 19:35:12 (+5.2, leave_in round(0.2) = 0 → "0 MIN")
    const col = column(busTarget, open(arrival('2026-05-22T19:35:00Z'), arrival('2026-05-22T19:35:12Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('NOW');
    expect(col.then?.leaveIn).toBe('0 MIN');
  });
});

describe('priority_split_v2.column - LATER list', () => {
  it('lists each compact "n MIN | hh:mm" row after THEN, oldest-first', () => {
    // NEXT 19:42, THEN 19:54; LATER 20:06 (31 MIN · 08:06) and 20:18 (43 MIN · 08:18)
    const col = column(
      busTarget,
      open(
        arrival('2026-05-22T19:42:00Z'),
        arrival('2026-05-22T19:54:00Z'),
        arrival('2026-05-22T20:06:00Z'),
        arrival('2026-05-22T20:18:00Z'),
      ),
      TZ,
      NOW,
    );
    expect(col.later).toEqual([
      { leaveIn: '31 MIN', clock: 'BY 08:01', deviation: null, cancelled: false, routePrefix: '' },
      { leaveIn: '43 MIN', clock: 'BY 08:13', deviation: null, cancelled: false, routePrefix: '' },
    ]);
  });

  it('caps the list at LATER_COUNT (2), dropping any further departures', () => {
    // NEXT, THEN, then three more all within the horizon — only the first two show.
    const col = column(
      busTarget,
      open(
        arrival('2026-05-22T19:42:00Z'), // NEXT
        arrival('2026-05-22T19:54:00Z'), // THEN
        arrival('2026-05-22T20:00:00Z'), // LATER 25 MIN · 08:00
        arrival('2026-05-22T20:06:00Z'), // LATER 31 MIN · 08:06
        arrival('2026-05-22T20:12:00Z'), // dropped — 3rd would-be row
      ),
      TZ,
      NOW,
    );
    expect(col.later).toEqual([
      { leaveIn: '25 MIN', clock: 'BY 07:55', deviation: null, cancelled: false, routePrefix: '' },
      { leaveIn: '31 MIN', clock: 'BY 08:01', deviation: null, cancelled: false, routePrefix: '' },
    ]);
  });

  it('is empty when nothing follows THEN', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z')), TZ, NOW);
    expect(col.later).toEqual([]);
  });

  it('excludes departures beyond the 60-minute horizon, keeping the one exactly on it', () => {
    // 20:30Z is exactly now + 60 → kept (leave_in 55, BY 08:25); 20:31Z is 61 min → excluded.
    const col = column(
      busTarget,
      open(
        arrival('2026-05-22T19:42:00Z'), // NEXT
        arrival('2026-05-22T19:54:00Z'), // THEN
        arrival('2026-05-22T20:30:00Z'), // exactly 60 min away → within horizon
        arrival('2026-05-22T20:31:00Z'), // 61 min away → beyond horizon
      ),
      TZ,
      NOW,
    );
    expect(col.later).toEqual([{ leaveIn: '55 MIN', clock: 'BY 08:25', deviation: null, cancelled: false, routePrefix: '' }]);
  });
});

describe('priority_split_v2.column - upcoming selection', () => {
  it('drops a missed departure (leave_by already passed) and starts NEXT at the earliest catchable one', () => {
    // 19:32Z: leave_by 19:27Z < now → missed. 19:48Z: leave_by 19:43Z ≥ now → upcoming.
    const col = column(busTarget, open(arrival('2026-05-22T19:32:00Z', '1'), arrival('2026-05-22T19:48:00Z', '1')), TZ, NOW);
    // leave_in for the first catchable = (18 - 5) = 13; nothing after it → THEN null
    expect(col.next?.leaveIn).toBe('13 MIN');
    expect(col.then).toBeNull();
  });

  it('sorts chronologically so NEXT is the soonest regardless of feed order', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:54:00Z'), arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.next?.arrives).toBe('ARR 07:42');
    expect(col.then?.arrives).toBe('ARR 07:54');
  });
});

describe('priority_split_v2.column - LAST row (just-missed service, #104)', () => {
  // The LAST window for busTarget (time_to_stop 5) at now 19:30Z is arrivals in
  // (19:30, 19:35): leave_by = arrival - 5 has passed, but now < arrival.

  it('tags RUN at minutes_late <= runLimit (default 1): -1 MIN renders RUN with the arrival clock', () => {
    // arrival 19:34Z (07:34): leave_by 19:29 < now, now < 19:34 → missed.
    // leave_in = (4 - 5) = -1 → minutes_late 1 ≤ 1 → RUN.
    const col = column(busTarget, open(arrival('2026-05-22T19:34:00Z')), TZ, NOW);
    expect(col.last).toEqual({ tag: 'RUN', leaveIn: '-1 MIN', arrives: 'ARR 07:34', deviation: null, cancelled: false, routePrefix: '' });
  });

  it('tags MISSED above the runLimit: -2 MIN renders MISSED', () => {
    // arrival 19:33Z: leave_in = (3 - 5) = -2 → minutes_late 2 > 1 → MISSED.
    const col = column(busTarget, open(arrival('2026-05-22T19:33:00Z')), TZ, NOW);
    expect(col.last).toEqual({
      tag: 'MISSED',
      leaveIn: '-2 MIN',
      arrives: 'ARR 07:33',
      deviation: null,
      cancelled: false,
      routePrefix: '',
    });
  });

  it('honours a per-phase runLimitMins override: -2 MIN is RUN when runLimit is 2', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T19:33:00Z'))], TZ, NOW, 2);
    expect(vm.columns[0].last).toEqual({
      tag: 'RUN',
      leaveIn: '-2 MIN',
      arrives: 'ARR 07:33',
      deviation: null,
      cancelled: false,
      routePrefix: '',
    });
  });

  it('omits the LAST row at the floor - now >= arrival_time hides it', () => {
    // arrival exactly at now (19:30Z): the service has reached the stop → omit.
    const col = column(busTarget, open(arrival('2026-05-22T19:30:00Z')), TZ, NOW);
    expect(col.last).toBeNull();
  });

  it('shows only the single most-recently-departed service when several have been missed', () => {
    // Both 19:31Z (late 4, MISSED) and 19:34Z (late 1, RUN) qualify; only the
    // most recent — 19:34Z — renders, so the row is RUN -1, not the older one.
    const col = column(busTarget, open(arrival('2026-05-22T19:31:00Z'), arrival('2026-05-22T19:34:00Z')), TZ, NOW);
    expect(col.last).toEqual({ tag: 'RUN', leaveIn: '-1 MIN', arrives: 'ARR 07:34', deviation: null, cancelled: false, routePrefix: '' });
  });

  it('renders the LAST row independently of NEXT - a just-missed echo above the next catchable hero', () => {
    // 19:34Z missed (RUN -1); 19:48Z upcoming (leave_in 13).
    const col = column(busTarget, open(arrival('2026-05-22T19:34:00Z'), arrival('2026-05-22T19:48:00Z')), TZ, NOW);
    expect(col.last?.tag).toBe('RUN');
    expect(col.next?.leaveIn).toBe('13 MIN');
  });

  it('is null when no departure is in the just-missed window', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.last).toBeNull();
  });

  it('serialises the LAST row to snake_case (tag, leave_in, arrives - no leave_by)', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T19:34:00Z'))], TZ, NOW);
    const json = toJsonView(vm) as { columns: { last: unknown }[] };
    expect(json.columns[0].last).toEqual({
      tag: 'RUN',
      leave_in: '-1 MIN',
      arrives: 'ARR 07:34',
      deviation: null,
      cancelled: false,
      route_prefix: '',
    });
  });
});

describe('priority_split_v2.column - deviation badges (DELAYED / EARLY, #105)', () => {
  it('badges a late NEXT departure DELAYED +n MIN, the delay growing Leave In', () => {
    // scheduled 19:40Z (leave_in would be (10 - 5) = 5); predicted 19:43Z, delay
    // +180s → +3 min. Leave In is computed against predicted: (13 - 5) = 8 — the
    // delay *grew* it from 5 — and the badge names the +3.
    const col = column(busTarget, open(arrival('2026-05-22T19:43:00Z', '1', 180)), TZ, NOW);
    expect(col.next?.leaveIn).toBe('8 MIN');
    expect(col.next?.arrives).toBe('ARR 07:43');
    expect(col.next?.deviation).toBe('DELAYED +3 MIN');
  });

  it('badges an early NEXT departure EARLY -n MIN, the early run shrinking Leave In', () => {
    // scheduled 19:50Z (leave_in would be (20 - 5) = 15); predicted 19:47Z, delay
    // -180s → 3 min early. Leave In against predicted: (17 - 5) = 12 — the early
    // run *shrank* it from 15 — and the badge names the -3 (leave sooner).
    const col = column(busTarget, open(arrival('2026-05-22T19:47:00Z', '1', -180)), TZ, NOW);
    expect(col.next?.leaveIn).toBe('12 MIN');
    expect(col.next?.arrives).toBe('ARR 07:47');
    expect(col.next?.deviation).toBe('EARLY -3 MIN');
  });

  it('shows no badge on an on-time departure (deviation rounds to 0)', () => {
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1', 0)), TZ, NOW);
    expect(col.next?.deviation).toBeNull();
  });

  it('rounds a late departure to whole minutes: 30s late -> DELAYED +1 MIN, 29s late -> no badge', () => {
    const late = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1', 30)), TZ, NOW);
    const onTime = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1', 29)), TZ, NOW);
    expect(late.next?.deviation).toBe('DELAYED +1 MIN');
    expect(onTime.next?.deviation).toBeNull();
  });

  it('rounds an early departure to whole minutes: 31s early -> EARLY -1 MIN, 29s early -> no badge', () => {
    const early = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1', -31)), TZ, NOW);
    const onTime = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1', -29)), TZ, NOW);
    expect(early.next?.deviation).toBe('EARLY -1 MIN');
    expect(onTime.next?.deviation).toBeNull();
  });

  it('badges the THEN hero when the second departure is the affected one', () => {
    // NEXT on time; THEN 19:55Z delayed +180s → DELAYED +3 MIN on THEN only.
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z', '1', 0), arrival('2026-05-22T19:55:00Z', '1', 180)), TZ, NOW);
    expect(col.next?.deviation).toBeNull();
    expect(col.then?.deviation).toBe('DELAYED +3 MIN');
  });

  it('badges a compact LATER row when its departure is early', () => {
    // NEXT, THEN on time; the LATER departure 20:06Z is 2 min early.
    const col = column(
      busTarget,
      open(arrival('2026-05-22T19:42:00Z', '1', 0), arrival('2026-05-22T19:54:00Z', '1', 0), arrival('2026-05-22T20:06:00Z', '1', -120)),
      TZ,
      NOW,
    );
    expect(col.later[0]?.deviation).toBe('EARLY -2 MIN');
  });

  it('omits the deviation badge on the LAST row even when the just-missed service deviated (#108)', () => {
    // 19:34Z just-missed (RUN -1), delay -120s: the service ran 2 min early, but
    // the LAST row carries no badge — it overran the split column and a missed
    // service's deviation is moot.
    const col = column(busTarget, open(arrival('2026-05-22T19:34:00Z', '1', -120)), TZ, NOW);
    expect(col.last?.tag).toBe('RUN');
    expect(col.last?.deviation).toBeNull();
  });

  it('serialises the deviation badge on every slot to its wire field', () => {
    // NEXT delayed +3, THEN early -2, one LATER delayed +1, plus a just-missed
    // LAST that ran early -2 — whose badge the LAST row drops (#108).
    const vm = viewModelFromStopStates(
      [busTarget],
      [
        open(
          arrival('2026-05-22T19:34:00Z', '1', -120), // LAST (just-missed, early -2)
          arrival('2026-05-22T19:43:00Z', '1', 180), // NEXT (delayed +3)
          arrival('2026-05-22T19:55:00Z', '1', -120), // THEN (early -2)
          arrival('2026-05-22T20:06:00Z', '1', 60), // LATER (delayed +1)
        ),
      ],
      TZ,
      NOW,
    );
    const json = toJsonView(vm) as {
      columns: {
        last: { deviation: unknown };
        next: { deviation: unknown };
        then: { deviation: unknown };
        later: { deviation: unknown }[];
      }[];
    };
    const c = json.columns[0];
    expect(c.last.deviation).toBeNull(); // dropped on the LAST row (#108)
    expect(c.next.deviation).toBe('DELAYED +3 MIN');
    expect(c.then.deviation).toBe('EARLY -2 MIN');
    expect(c.later[0].deviation).toBe('DELAYED +1 MIN');
  });
});

describe('priority_split_v2.column - closed stop', () => {
  it('is a no-service column (no departure at all) keeping the configured route id in the header', () => {
    const col = column(busTarget, { kind: 'closed' }, TZ, NOW);
    expect(col.serviceId).toBe('1'); // fallback to the target's first service id
    expect(col.tripHeadsign).toBe('');
    expect(col.next).toBeNull();
    expect(col.then).toBeNull();
    // No departures at all → no-service with no next-available clock (#106).
    expect(col.noService).toEqual({ nextDeparture: null });
  });

  it('resolves the any-of array to its first id for the header fallback', () => {
    const arrayTarget: TransitTarget = { ...busTarget, serviceId: ['634', '635'] };
    const col = column(arrayTarget, { kind: 'closed' }, TZ, NOW);
    expect(col.serviceId).toBe('634');
  });
});

describe('priority_split_v2.column - cancelled service (#106)', () => {
  it('renders a cancelled NEXT struck (scheduled clock, no Leave In) and falls the leave-time to the next live hero', () => {
    // Cancelled 19:42 (07:42) is NEXT; the live 19:54 becomes THEN with the real
    // Leave In (24 - 5 = 19). The struck scheduled clock fills NEXT's value area.
    const col = column(busTarget, open(cancelledArrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z')), TZ, NOW);
    expect(col.next).toEqual({ leaveIn: '', leaveBy: '', arrives: '07:42', deviation: null, cancelled: true, routePrefix: '' });
    expect(col.then?.leaveIn).toBe('19 MIN');
    expect(col.then?.cancelled).toBe(false);
  });

  it('renders a cancelled LATER departure struck (scheduled clock, no Leave In)', () => {
    // NEXT 19:42, THEN 19:54 live; the LATER departure 20:06 (08:06) is cancelled.
    const col = column(
      busTarget,
      open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z'), cancelledArrival('2026-05-22T20:06:00Z')),
      TZ,
      NOW,
    );
    expect(col.later).toEqual([{ leaveIn: '', clock: '08:06', deviation: null, cancelled: true, routePrefix: '' }]);
  });

  it('renders a cancelled LAST (just-missed) service struck with no RUN/MISSED tag', () => {
    // Cancelled 19:34 (07:34): leave_by 19:29 < now, now < 19:34 → just-missed,
    // but cancelled → struck, no tag (it was never catchable).
    const col = column(busTarget, open(cancelledArrival('2026-05-22T19:34:00Z')), TZ, NOW);
    expect(col.last).toEqual({ tag: '', leaveIn: '', arrives: '07:34', deviation: null, cancelled: true, routePrefix: '' });
  });

  it('serialises a cancelled slot to snake_case (cancelled flag, struck clock in arrives)', () => {
    const vm = viewModelFromStopStates([busTarget], [open(cancelledArrival('2026-05-22T19:42:00Z'))], TZ, NOW);
    const json = toJsonView(vm) as { columns: { next: unknown }[] };
    expect(json.columns[0].next).toEqual({
      leave_in: '',
      leave_by: '',
      arrives: '07:42',
      deviation: null,
      cancelled: true,
      route_prefix: '',
    });
  });
});

describe('priority_split_v2.column - no-service state (#106)', () => {
  it('shows NO SERVICE with the next available clock and suppresses THEN/LATER when nothing is within 60 min', () => {
    // Sole departure 20:45 (08:45) is 75 min away → beyond the horizon.
    const col = column(busTarget, open(arrival('2026-05-22T20:45:00Z')), TZ, NOW);
    expect(col.noService).toEqual({ nextDeparture: '08:45' });
    expect(col.next).toBeNull();
    expect(col.then).toBeNull();
    expect(col.later).toEqual([]);
    expect(col.serviceId).toBe('1'); // still names the route from the next-available departure
  });

  it('still renders the LAST row in the no-service state', () => {
    // Just-missed 19:34 (RUN -1) plus a far 20:45 departure beyond the horizon.
    const col = column(busTarget, open(arrival('2026-05-22T19:34:00Z'), arrival('2026-05-22T20:45:00Z')), TZ, NOW);
    expect(col.noService).toEqual({ nextDeparture: '08:45' });
    expect(col.last?.tag).toBe('RUN');
  });

  it('serialises the no-service state to snake_case', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T20:45:00Z'))], TZ, NOW);
    const json = toJsonView(vm) as { columns: { no_service: unknown; next: unknown }[] };
    expect(json.columns[0].no_service).toEqual({ next_departure: '08:45' });
    expect(json.columns[0].next).toBeNull();
  });
});

describe('priority_split_v2.column - partial horizon (#106)', () => {
  it('fills only the slots within 60 min - one in-horizon departure renders NEXT alone, no no-service', () => {
    // NEXT 19:42 (within); the next departure 20:45 is beyond the horizon, so it
    // does NOT fill THEN — the column renders only what is within 60 min.
    const col = column(busTarget, open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T20:45:00Z')), TZ, NOW);
    expect(col.next?.leaveIn).toBe('7 MIN');
    expect(col.then).toBeNull();
    expect(col.later).toEqual([]);
    expect(col.noService).toBeNull();
  });

  it('a cancelled departure within the horizon is a departure - struck NEXT, not a no-service state', () => {
    const col = column(busTarget, open(cancelledArrival('2026-05-22T19:42:00Z')), TZ, NOW);
    expect(col.noService).toBeNull();
    expect(col.next?.cancelled).toBe(true);
  });
});

describe('priority_split_v2.column - per-row service-id prefix for any-of targets (#107)', () => {
  // An any-of serviceId target: successive departures under one column header may
  // be different routes (635 / 636), so each row carries its own service id.
  const anyOfTarget: TransitTarget = { ...busTarget, serviceId: ['635', '636'] };

  it("prefixes every row (NEXT/THEN/LATER/LAST) with that departure's own service id", () => {
    const col = column(
      anyOfTarget,
      open(
        arrival('2026-05-22T19:34:00Z', '636'), // LAST (just-missed)
        arrival('2026-05-22T19:42:00Z', '635'), // NEXT
        arrival('2026-05-22T19:54:00Z', '636'), // THEN
        arrival('2026-05-22T20:06:00Z', '635'), // LATER
      ),
      TZ,
      NOW,
    );
    expect(col.last?.routePrefix).toBe('636');
    expect(col.next?.routePrefix).toBe('635');
    expect(col.then?.routePrefix).toBe('636');
    expect(col.later[0]?.routePrefix).toBe('635');
  });

  it('prefixes a cancelled departure too - the struck row stays route-distinguishable', () => {
    // Cancelled NEXT on route 636, live THEN on 635.
    const col = column(anyOfTarget, open(cancelledArrival('2026-05-22T19:42:00Z', '636'), arrival('2026-05-22T19:54:00Z', '635')), TZ, NOW);
    expect(col.next?.cancelled).toBe(true);
    expect(col.next?.routePrefix).toBe('636');
    expect(col.then?.routePrefix).toBe('635');
  });

  it('serialises the per-row prefix to snake_case route_prefix on every slot', () => {
    const vm = viewModelFromStopStates(
      [anyOfTarget],
      [
        open(
          arrival('2026-05-22T19:34:00Z', '636'), // LAST
          arrival('2026-05-22T19:42:00Z', '635'), // NEXT
          arrival('2026-05-22T19:54:00Z', '636'), // THEN
          arrival('2026-05-22T20:06:00Z', '635'), // LATER
        ),
      ],
      TZ,
      NOW,
    );
    const json = toJsonView(vm) as {
      columns: {
        last: { route_prefix: unknown };
        next: { route_prefix: unknown };
        then: { route_prefix: unknown };
        later: { route_prefix: unknown }[];
      }[];
    };
    const c = json.columns[0];
    expect(c.last.route_prefix).toBe('636');
    expect(c.next.route_prefix).toBe('635');
    expect(c.then.route_prefix).toBe('636');
    expect(c.later[0].route_prefix).toBe('635');
  });
});

describe('priority_split_v2.column - single-route target renders no per-row prefix (#107)', () => {
  it("leaves every row's routePrefix empty for a single-route target", () => {
    // busTarget is a bare single-route ('1') target — no row carries a prefix.
    const col = column(
      busTarget,
      open(
        arrival('2026-05-22T19:34:00Z', '1'), // LAST
        arrival('2026-05-22T19:42:00Z', '1'), // NEXT
        arrival('2026-05-22T19:54:00Z', '1'), // THEN
        arrival('2026-05-22T20:06:00Z', '1'), // LATER
      ),
      TZ,
      NOW,
    );
    expect(col.last?.routePrefix).toBe('');
    expect(col.next?.routePrefix).toBe('');
    expect(col.then?.routePrefix).toBe('');
    expect(col.later[0]?.routePrefix).toBe('');
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

    // Bus column: leave_in = (12 - 5) = 7, mode bus, service id from NEXT.
    expect(vm.columns[0].mode).toBe('bus');
    expect(vm.columns[0].serviceId).toBe('1');
    expect(vm.columns[0].next?.leaveIn).toBe('7 MIN');

    // Train column computes from *its own* time_to_stop (15): predicted 20:00Z =
    // now + 30 min, leave_in = 30 - 15 = 15. Independent of the bus column.
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
          last: null,
          no_service: null,
          next: { leave_in: '7 MIN', leave_by: 'BY 07:37', arrives: 'ARR 07:42', deviation: null, cancelled: false, route_prefix: '' },
          then: { leave_in: '19 MIN', leave_by: 'BY 07:49', arrives: 'ARR 07:54', deviation: null, cancelled: false, route_prefix: '' },
          later: [],
        },
      ],
    });
  });

  it('serialises an absent THEN slot as null', () => {
    const vm = viewModelFromStopStates([busTarget], [open(arrival('2026-05-22T19:42:00Z'))], TZ, NOW);
    const json = toJsonView(vm) as { columns: { then: unknown }[] };
    expect(json.columns[0].then).toBeNull();
  });

  it('serialises the LATER rows as compact snake_case { leave_in, clock } objects', () => {
    // NEXT 19:42, THEN 19:54, one LATER 20:06 = now + 36, leave_in = 36 - 5 = 31, BY 08:01 (08:06 − 5)
    const vm = viewModelFromStopStates(
      [busTarget],
      [open(arrival('2026-05-22T19:42:00Z'), arrival('2026-05-22T19:54:00Z'), arrival('2026-05-22T20:06:00Z'))],
      TZ,
      NOW,
    );
    const json = toJsonView(vm) as { columns: { later: unknown }[] };
    expect(json.columns[0].later).toEqual([{ leave_in: '31 MIN', clock: 'BY 08:01', deviation: null, cancelled: false, route_prefix: '' }]);
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
