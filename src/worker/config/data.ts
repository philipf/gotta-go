// PoC seed data for the PRD global:, profiles: and radiators: blocks. Each
// profile leaves an overnight gap outside its phases, which the resolver falls
// through to the idle profile (idle_jokes, #17) — so server time is not always
// inside a configured phase by design.

import type { Global, IdleProfile, Profile } from "./types";

// PRD §9 `global:` block.
export const GLOBAL: Global = {
  timezone: "Pacific/Auckland",
  defaultRefreshIntervalMinutes: 3,
  // High by design: Metlink truncates server-side, and a generous window keeps
  // a watched service visible at busy shared stops (see Global.stopPredictionLimit).
  stopPredictionLimit: 1000,
};

// The system-wide default idle profile (ADR-0003 / #17). The resolver falls
// through to this when server time is outside every configured phase, unless
// the slug's profile carries its own `idle` override. Renders ambient content
// (a dad joke + meme) on the long overnight sleep — see features/idle_jokes.
export const SYSTEM_IDLE_DEFAULT: IdleProfile = {
  layout: "idle_jokes",
};

// PRD §9 `profiles:` block — named profiles keyed by profile name. Each
// profile owns its phases (and may carry an `idle` override; both seeds use the
// system default). Multiple radiators may share one profile. Phases do not
// cover the whole day — the uncovered overnight hours fall through to the idle
// profile (#17).
export const PROFILES: Record<string, Profile> = {
  philip_and_tania: {
    name: "philip_and_tania",
    phases: [
      // Morning commute (PRD §9): a two-target priority_split phase rendering
      // the bus stop and train station side by side. Stop 3234 + route 1 and
      // station TAKA1 + line KPL are the live-validated IDs from ADR-0002 (the
      // PRD's 7104/WELL/5112 are placeholders the spike replaced). Listed first
      // so its window wins over the all-day fallback during 06:30–09:00.
      {
        key: "morning_commute",
        startTime: "05:45",
        endTime: "09:00",
        layout: "priority_split",
        refreshIntervalMinutes: 1,
        transitTargets: [
          {
            mode: "bus",
            stopId: "3234",
            serviceId: "1",
            timeToStopMins: 4,
            comfortBuffer: 1.5,
          },
          {
            mode: "train",
            stopId: "TAKA1",
            serviceId: "KPL",
            timeToStopMins: 7,
            comfortBuffer: 1.5,
          },
        ],
      },
      // Afternoon commute home from the city (the reverse of morning).
      // priority_split over two targets: bus 5012 (Lambton Central Stop A)
      // route 1 outbound → Churton Park, and the KPL line boarding at
      // Wellington Station (WELL) outbound → Waikanae, alighting at Takapu
      // Road. Stop/service IDs live-validated against /stop-predictions.
      // Listed before daytime_calendar so its 15:15–21:00 window wins over
      // the calendar during the evening commute (resolver picks the first
      // matching phase — see schedule/resolve.ts).
      {
        key: "afternoon_commute",
        startTime: "15:15",
        endTime: "21:00",
        layout: "priority_split",
        refreshIntervalMinutes: 1,
        transitTargets: [
          {
            mode: "bus",
            stopId: "5012",
            serviceId: "1",
            // Route 1 branches at this stop (Churton Park / Grenada Village /
            // Johnsonville West); pin to the Churton Park terminus so only the
            // wanted buses surface (#68). Live-validated 2026-06-02.
            destinationStopId: "3281",
            timeToStopMins: 10,
            comfortBuffer: 1.5,
          },
          {
            mode: "train",
            stopId: "WELL",
            serviceId: "KPL",
            // Peak KPL expresses run WELL → Porirua nonstop, skipping Takapu
            // Road — same route and (for Waikanae runs) same terminus as the
            // stopping trains, so only the destination-name suffix tells them
            // apart ("WAIK - Express" vs "WAIK/PORI - All stops"). Require
            // "All stops" so expresses drop out (#77). Live-validated
            // 2026-06-04.
            destinationNameIncludes: "All stops",
            timeToStopMins: 10,
            comfortBuffer: 1.5,
          },
        ],
      },
      // Daytime two-month calendar between the morning and afternoon commute
      // windows (GH #76, replacing the daytime clock). Window stays
      // 09:00–21:00 but afternoon_commute precedes it in the array, so
      // 15:15–21:00 resolves to the commute; the calendar only wins
      // 09:00–15:15. Bounded at 21:00 (not all-day) so the 21:00–05:45
      // overnight gap still falls through to the idle profile → idle_jokes
      // (#17). Interim home: #76's dedicated office radiator (full-day, 4h
      // cap) comes later — here the refresh must stay well under the gap to
      // afternoon_commute because resolveProfilePhase returns the flat
      // interval without truncating at the next phase boundary; 30 min caps
      // the commute pickup delay while the unchanged-frame skip (#73/#74)
      // keeps every same-day wake flash-free.
      {
        key: "daytime_calendar",
        startTime: "09:00",
        endTime: "21:00",
        layout: "dual_month_calendar",
        refreshIntervalMinutes: 30,
      },
    ],
  },
  // Daughter's school-run profile (PRD §9): a priority_split morning phase
  // over one bus transit target, then a minimal_clock idle phase. Stop 3234
  // + routes 634/635 validated in GH #16 / ADR-0002.
  daughter_school: {
    name: "daughter_school",
    phases: [
      {
        key: "morning_school_run",
        startTime: "07:15",
        endTime: "08:30",
        layout: "priority_split",
        refreshIntervalMinutes: 2,
        transitTargets: [
          {
            mode: "bus",
            stopId: "3234",
            serviceId: ["634", "635"],
            timeToStopMins: 5,
            comfortBuffer: 3,
          },
        ],
      },
      {
        key: "afternoon_idle",
        startTime: "08:30",
        endTime: "21:00",
        layout: "minimal_clock",
        refreshIntervalMinutes: 30,
      },
    ],
  },
};

// PRD §9 `radiators:` block — radiator slug → profile-name reference.
// The slug is the X-Radiator-Slug header value, hardcoded in firmware.
// The reference is resolved at lookup time so callers see a fully
// populated `Radiator` with its `profile` inlined.
export const RADIATOR_REFS: Record<
  string,
  { slug: string; profileName: string }
> = {
  "bedroom-philip-tania": {
    slug: "bedroom-philip-tania",
    profileName: "philip_and_tania",
  },
  "bedroom-daughter": {
    slug: "bedroom-daughter",
    profileName: "daughter_school",
  },
};
