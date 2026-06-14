// Dev-only dogfooding aid (issue #108): pads each open stop's arrivals with
// synthetic future departures so the priority_split_v2 THEN / LATER slots
// populate even when the live Metlink feed is sparse (e.g. an evening commute
// stop that only has one upcoming service), and stamps a DELAYED deviation and a
// cancelled service so those states render for review. Gated by DEV_PAD_LATER in
// .dev.vars — never set in production — and isolated here, like debug/dev-time.ts,
// so it is trivial to delete once v2 is dogfooded. The padding flows through the
// normal domain projection, so Leave In / Leave By / arrival / badges are all
// computed for real; only the source departures are fabricated.

import type { Arrival, StopState } from '../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../config/config-types';

const MS_PER_MIN = 60_000;

const PAD_TO = 6; // ensure this many *near-term* departures: NEXT + THEN + 3 LATER, with headroom
const HEADWAY_MINUTES = 10; // spacing of the synthetic departures
const SYNTH_OFFSET_MINUTES = 6; // first synthetic departure, minutes from now

// Per-rung schedule deviation in signed minutes (+ late → DELAYED). With the
// nearTerm count below excluding just-missed services, the ladder rungs map
// straight onto the visible slots: rung 0 → NEXT, 1 → THEN, 2 → first LATER, …
// So this stamps a DELAYED badge on the NEXT hero and a wide one on a LATER row
// (the tightest row) for the render-fit review.
const DEVIATIONS: Record<number, number> = { 0: 3, 2: 12 };

// The ladder rung rendered as a cancelled service, on the train column only
// (KPL): rung 1 → the THEN hero, so the struck-clock hero state (#106) is shown
// for review. Bus columns render their THEN normally.
const CANCEL_RUNG = 1;

// The ladder rung forced to the NOW zero-state, on the bus column only: rung 0 →
// the NEXT hero. Its `predicted` is set one stop-walk (timeToStopMins) ahead so
// Leave In rounds to 0 and the renderer shows NOW (#102) instead of a minutes
// value. Train columns keep their DELAYED NEXT.
const NOW_RUNG = 0;

// leave_by_time = arrival_time − time_to_stop_mins (mirrors domain-service.ts).
function leaveByMs(a: Arrival, target: TransitTarget): number {
  return a.predicted.getTime() - target.timeToStopMins * MS_PER_MIN;
}

// Builds one synthetic departure on the ladder at `predicted`. A DELAYED rung
// keeps `predicted` on the ladder (so the row's times don't move) and offsets
// `scheduled` so the renderer derives the badge for real. A cancelled rung
// carries status 'cancelled' and no deviation — the renderer shows only its
// struck scheduled clock.
function synthDeparture(template: Arrival | undefined, predicted: Date, devMins: number, cancelled: boolean, rung: number): Arrival {
  const delaySeconds = cancelled ? 0 : devMins * 60;
  return {
    serviceId: template?.serviceId ?? 'DEV',
    tripHeadsign: template?.tripHeadsign ?? 'DEV PADDED',
    name: template?.name ?? 'DEV PADDED',
    scheduled: new Date(predicted.getTime() - delaySeconds * 1000),
    predicted,
    delaySeconds,
    status: cancelled ? 'cancelled' : devMins > 0 ? 'delayed' : devMins < 0 ? 'early' : 'scheduled',
    tripId: `dev-pad-${rung}`,
  };
}

// Adds a synthetic departure ladder anchored at `now` (now+6, now+16, …) until
// each open stop carries PAD_TO upcoming near-term departures. Anchoring at `now`
// — not after the latest real arrival — is deliberate: the v2 domain projects
// NEXT/THEN/LATER only from departures inside a 60-min horizon, so a ladder
// appended after a far-future tail would fall outside it and never populate the
// slots. The ladder is sized so all PAD_TO rungs sit within the horizon. Real
// arrivals are kept and merged (the domain re-sorts by time); closed stops are
// returned unchanged. `targets` align with `states` by index (same as the domain
// projection), so the train column can be singled out for the cancelled case.
export function padArrivalsForDev(states: StopState[], targets: TransitTarget[], now: Date): StopState[] {
  return states.map((state, i) => {
    if (state.kind !== 'open') return state;
    const target = targets[i];

    // Count only genuinely-upcoming near-term departures — leave_by still in the
    // future and within the horizon — i.e. exactly the ones the domain would keep
    // for NEXT/THEN/LATER. Excluding the just-missed service (leave_by passed)
    // keeps the rung → slot mapping predictable.
    const horizonMs = (SYNTH_OFFSET_MINUTES + (PAD_TO - 1) * HEADWAY_MINUTES) * MS_PER_MIN;
    const nearTerm = state.arrivals.filter((a) => {
      return leaveByMs(a, target) >= now.getTime() && a.predicted.getTime() - now.getTime() <= horizonMs;
    });
    if (nearTerm.length >= PAD_TO) return state;

    const template = state.arrivals[state.arrivals.length - 1];
    const base = now.getTime() + SYNTH_OFFSET_MINUTES * MS_PER_MIN;
    const synthetic: Arrival[] = [];
    for (let r = 0; nearTerm.length + synthetic.length < PAD_TO; r++) {
      const cancelled = target.mode === 'train' && r === CANCEL_RUNG;
      const isNow = target.mode === 'bus' && r === NOW_RUNG;
      // NOW: one stop-walk away so Leave In rounds to 0; otherwise the ladder.
      const predicted = isNow
        ? new Date(now.getTime() + target.timeToStopMins * MS_PER_MIN)
        : new Date(base + r * HEADWAY_MINUTES * MS_PER_MIN);
      const devMins = isNow ? 0 : (DEVIATIONS[r] ?? 0);
      synthetic.push(synthDeparture(template, predicted, devMins, cancelled, r));
    }
    return { kind: 'open', arrivals: [...state.arrivals, ...synthetic] };
  });
}
