// Domain types mirroring the PRD config.yaml shape (Global, ProfilePhase,
// Profile, Radiator). Re-exports LayoutKey from the frame registry so
// phase layout values are constrained to what's actually implemented.

import type { LayoutKey } from '../features/frame-registry';
import type { Mode } from '../features/priority_split_v2/mode-icon';

export type { LayoutKey };

// One configured stop/station a radiator watches inside a profile phase
// (glossary §7 "transit target"). `serviceId` accepts a single route or an
// any-of array (Metlink reference); `time_to_stop_mins` is the walk/transfer
// margin subtracted from each arrival to derive its Leave By time (glossary §3).
// `destinationStopId` narrows a route that
// branches to several termini at a shared stop down to the wanted terminus —
// when set, only departures bound for a matching `destination.stop_id` survive
// (#68). Mirrors `serviceId`: a single id or an any-of array; absent means no
// destination filter. `destinationNameIncludes` requires `destination.name`
// to contain one of the given substrings (case-insensitive) — it excludes
// express runs that share route *and* terminus with stopping trains but skip
// the rider's station (#77). A require-substring filter fails closed if the
// upstream rewording drops the suffix: no trains shown beats suggesting one
// that sails past the stop. Same single-or-any-of shape; absent → no filter.
export type TransitTarget = {
  mode: Mode;
  stopId: string;
  serviceId: string | string[];
  destinationStopId?: string | string[];
  destinationNameIncludes?: string | string[];
  timeToStopMins: number;
};

// Mirrors PRD §9 `global:` — household-level settings shared by every
// radiator. The PoC seeds one record; future config gains more keys.
export type Global = {
  timezone: string;
  defaultRefreshIntervalMinutes: number;
  // Upper bound for the Metlink /stop-predictions `limit`. The limit is applied
  // upstream across *all* services at a stop before the gateway filters to a
  // watched service, so at a shared stop a low limit can push a watched service
  // out of the window entirely — the empty result then renders no-service even
  // when buses are due (#36/#10). Set high so Metlink itself decides the
  // truncation point; it caps the value server-side.
  stopPredictionLimit: number;
};

// Mirrors PRD §9 profile phase — a time-of-day phase inside a profile.
// `key` is the phase identifier (e.g. `morning_commute`, `daytime_calendar`).
export type ProfilePhase = {
  key: string;
  startTime: string;
  endTime: string;
  layout: LayoutKey;
  refreshIntervalMinutes: number;
  // The weekdays this phase is eligible to run (glossary "Active days").
  // Absent = every day (the common case). A phase whose active days exclude
  // the local (Pacific/Auckland) weekday is skipped by the resolver — used to
  // keep weekday commute phases from firing on weekends (#92 / ADR-0015). A
  // config.test.ts invariant forbids an empty array (a silent dead phase).
  days?: Weekday[];
  // Present for priority_split_v2 phases; absent for minimal_clock.
  transitTargets?: TransitTarget[];
  // priority_split_v2 only — the RUN limit (glossary): the largest lateness
  // (in minutes) at which the LAST row's just-missed service is still
  // sprintable and tagged `RUN` rather than `MISSED`. Absent → the domain
  // default of 1 min (#104).
  runLimitMins?: number;
};

// Lowercase three-letter weekday tokens — the vocabulary of a phase's active
// days. Matches the output of shared/weekday so the resolver compares with a
// plain `days.includes(weekday(now, tz))`.
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

// The idle profile a slug falls through to when server time is outside every
// configured phase (ADR-0003 §"Idle profile" / #17). System-wide by default
// (SYSTEM_IDLE_DEFAULT in data.ts); a profile may override it. Only the layout
// is configurable today — both the default and any override resolve to
// `idle_jokes`, rendered under the literal `idle_profile` phase key.
export type IdleProfile = {
  layout: LayoutKey;
};

// Mirrors PRD §9 `profiles:` entry — a named user/household configuration.
// One profile may be shared by multiple radiators (PRD §7). `idle` overrides
// the system-wide idle profile for this profile's overnight gaps; absent → the
// system default.
export type Profile = {
  name: string;
  phases: ProfilePhase[];
  idle?: IdleProfile;
};

// Mirrors PRD §9 `radiators:` entry — one physical radiator. The slug
// uniquely identifies the device (X-Radiator-Slug header, hardcoded in
// firmware); the profile is resolved at lookup time. Future per-radiator
// fields (display capabilities, etc.) attach here.
export type Radiator = {
  slug: string;
  profile: Profile;
};
