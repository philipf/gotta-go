// Seed data for global, profiles, and radiators config used in local development.

import type { Global, IdleProfile, Profile, TransitTarget, Weekday } from './config-types';

// Active days for the commute/school rituals (glossary "Active days", #92 /
// ADR-0015): Monday–Friday. Shared so the four weekday-only phases can't drift
// apart. Calendar and idle-clock phases omit `days` entirely (every day).
const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

// PRD §9 `global:` block.
export const GLOBAL: Global = {
  timezone: 'Pacific/Auckland',
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
  layout: 'idle_jokes',
};

// The city→home afternoon targets, shared by every profile that watches the
// commute out of the CBD (philip_and_tania's afternoon_commute and
// philip_office's office_afternoon_commute, #86). One constant so the
// live-validated filters below can't drift apart between radiators; if walk
// times ever need to differ per desk, fork the constant at that point.
//
// Bus: 5012 (Lambton Central Stop A) route 1 outbound → Churton Park. Route 1
// branches at this stop (Churton Park / Grenada Village / Johnsonville West);
// pin to the Churton Park terminus so only the wanted buses surface (#68).
// Live-validated 2026-06-02.
//
// Train: KPL line boarding at Wellington Station (WELL) outbound → Waikanae,
// alighting at Takapu Road. Peak KPL expresses run WELL → Porirua nonstop,
// skipping Takapu Road — same route and (for Waikanae runs) same terminus as
// the stopping trains, so only the destination-name suffix tells them apart
// ("WAIK - Express" vs "WAIK/PORI - All stops"). Require "All stops" so
// expresses drop out (#77). Live-validated 2026-06-04.
const CITY_TO_HOME_TARGETS: TransitTarget[] = [
  {
    mode: 'bus',
    stopId: '5012',
    serviceId: '1',
    destinationStopId: '3281',
    timeToStopMins: 10,
  },
  {
    mode: 'train',
    stopId: 'WELL',
    serviceId: 'KPL',
    destinationNameIncludes: 'All stops',
    timeToStopMins: 10,
  },
];

// PRD §9 `profiles:` block — named profiles keyed by profile name. Each
// profile owns its phases (and may carry an `idle` override; both seeds use the
// system default). Multiple radiators may share one profile. Phases do not
// cover the whole day — the uncovered overnight hours fall through to the idle
// profile (#17).
export const PROFILES: Record<string, Profile> = {
  philip_and_tania: {
    name: 'philip_and_tania',
    phases: [
      // Morning commute (PRD §9): stop 3234 + route 1 and station TAKA1 + line
      // KPL are the live-validated IDs from the Metlink spike (the PRD's
      // 7104/WELL/5112 were placeholders the spike replaced). Listed first so
      // it wins over the daytime_calendar fallback while its window is open.
      {
        key: 'morning_commute',
        startTime: '05:45',
        endTime: '08:45',
        layout: 'priority_split_v2',
        refreshIntervalMinutes: 1,
        days: WEEKDAYS,
        transitTargets: [
          {
            mode: 'bus',
            stopId: '3234',
            serviceId: '1',
            timeToStopMins: 4,
          },
          {
            mode: 'train',
            stopId: 'TAKA1',
            serviceId: 'KPL',
            timeToStopMins: 8,
          },
        ],
      },
      // Afternoon commute home — the reverse of morning, over the shared
      // city→home targets (stop/service rationale lives on CITY_TO_HOME_TARGETS).
      // Listed before daytime_calendar so it wins while its window overlaps the
      // calendar's (resolver picks the first matching phase — see resolve.ts).
      {
        key: 'afternoon_commute',
        startTime: '16:00',
        endTime: '18:30',
        layout: 'priority_split_v2',
        refreshIntervalMinutes: 1,
        days: WEEKDAYS,
        transitTargets: CITY_TO_HOME_TARGETS,
      },
      // Daytime two-month calendar filling the gap between the commutes (#76,
      // replacing the daytime clock). Starts at morning_commute's end so no
      // idle gap opens at the handoff. Not all-day, so the uncovered overnight
      // hours fall through to the idle profile → idle_jokes (#17). The calendar
      // barely changes within a day, so a long refresh suffices —
      // resolveProfilePhase truncates the sleep at the next phase boundary, so
      // the afternoon pickup is never delayed, and the unchanged-frame skip
      // (#73/#74) keeps each wake flash-free.
      {
        key: 'daytime_calendar',
        startTime: '08:45',
        endTime: '21:00',
        layout: 'dual_month_calendar',
        refreshIntervalMinutes: 180,
      },
    ],
  },
  // Philip's F5 office-desk profile (#86): the city→home afternoon commute
  // bracketed by two-month calendars. On weekdays the phases tile the full day
  // so the idle profile never engages; on weekends the mon–fri commute (#92)
  // drops out and its slot falls through to idle_jokes — the unattended desk no
  // longer burns those wakes. The only visible calendar flash is the midnight
  // rollover (unchanged-frame skip, #73/#74). The key is
  // office_afternoon_commute (not a second afternoon_commute) because phase
  // keys are globally unique across profiles — the test-<phaseKey> scenario
  // slugs (#21) resolve a phase by bare key.
  philip_office: {
    name: 'philip_office',
    phases: [
      {
        key: 'morning_calendar',
        startTime: '00:00',
        endTime: '15:30',
        layout: 'dual_month_calendar',
        refreshIntervalMinutes: 240,
      },
      {
        key: 'office_afternoon_commute',
        startTime: '15:30',
        endTime: '18:35',
        layout: 'priority_split_v2',
        refreshIntervalMinutes: 1,
        days: WEEKDAYS,
        transitTargets: CITY_TO_HOME_TARGETS,
      },
      {
        key: 'evening_calendar',
        startTime: '18:35',
        endTime: '24:00',
        layout: 'dual_month_calendar',
        refreshIntervalMinutes: 240,
      },
    ],
  },
  // Daughter's school-run profile (PRD §9): stop 3234 + routes 634/635
  // validated in GH #16 / the Metlink spike, then an idle clock the rest of
  // the day.
  daughter_school: {
    name: 'daughter_school',
    phases: [
      {
        key: 'morning_school_run',
        startTime: '07:15',
        endTime: '08:30',
        layout: 'priority_split_v2',
        refreshIntervalMinutes: 2,
        days: WEEKDAYS,
        transitTargets: [
          {
            mode: 'bus',
            stopId: '3234',
            serviceId: ['634', '635'],
            timeToStopMins: 5,
          },
        ],
      },
      {
        key: 'afternoon_idle',
        startTime: '08:30',
        endTime: '21:00',
        layout: 'minimal_clock',
        refreshIntervalMinutes: 30,
      },
    ],
  },
};

// PRD §9 `radiators:` block — radiator slug → profile-name reference.
// The slug is the X-Radiator-Slug header value, hardcoded in firmware.
// The reference is resolved at lookup time so callers see a fully
// populated `Radiator` with its `profile` inlined.
export const RADIATOR_REFS: Record<string, { slug: string; profileName: string }> = {
  'bedroom-philip-tania': {
    slug: 'bedroom-philip-tania',
    profileName: 'philip_and_tania',
  },
  'bedroom-daughter': {
    slug: 'bedroom-daughter',
    profileName: 'daughter_school',
  },
  'office-f5': {
    slug: 'office-f5',
    profileName: 'philip_office',
  },
};
