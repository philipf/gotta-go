// Dev-only dogfooding aid (issue #108): pads each open stop's arrivals with
// synthetic future departures so the priority_split_v2 THEN / LATER slots
// populate even when the live Metlink feed is sparse (e.g. an evening commute
// stop that only has one upcoming service). Gated by DEV_PAD_LATER in .dev.vars
// — never set in production — and isolated here, like debug/dev-time.ts, so it
// is trivial to delete once v2 is dogfooded. The padding flows through the
// normal domain projection, so Leave In / Leave By / arrival / badges are all
// computed for real; only the source departures are fabricated.

import type { Arrival, StopState } from '../gateways/metlink/fetch-arrivals';

const PAD_TO = 5; // ensure at least this many upcoming departures per open stop
const HEADWAY_MINUTES = 10; // spacing of the synthetic departures
const SYNTH_OFFSET_MINUTES = 6; // first synthetic departure, minutes from now

// Appends synthetic on-time arrivals after the latest real one (or after `now`
// when the feed is empty) until each open stop carries PAD_TO upcoming
// departures. Closed stops and already-full stops are returned unchanged.
export function padArrivalsForDev(states: StopState[], now: Date): StopState[] {
  return states.map((state) => {
    if (state.kind !== 'open') return state;
    const upcoming = state.arrivals.filter((a) => a.predicted.getTime() >= now.getTime());
    if (upcoming.length >= PAD_TO) return state;

    const template = state.arrivals[state.arrivals.length - 1];
    const lastTime = template ? template.predicted.getTime() : now.getTime() + SYNTH_OFFSET_MINUTES * 60_000 - HEADWAY_MINUTES * 60_000;
    const synthetic: Arrival[] = [];
    for (let i = 1; upcoming.length + synthetic.length < PAD_TO; i++) {
      const when = new Date(lastTime + i * HEADWAY_MINUTES * 60_000);
      synthetic.push({
        serviceId: template?.serviceId ?? 'DEV',
        tripHeadsign: template?.tripHeadsign ?? 'DEV PADDED',
        name: template?.name ?? 'DEV PADDED',
        scheduled: when,
        predicted: when,
        delaySeconds: 0,
        status: 'scheduled',
        tripId: `dev-pad-${i}`,
      });
    }
    return { kind: 'open', arrivals: [...state.arrivals, ...synthetic] };
  });
}
