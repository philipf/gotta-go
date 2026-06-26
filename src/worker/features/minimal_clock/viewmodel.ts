// Data contract for minimal_clock: the format-agnostic ViewModel and its JSON projection.

import type { BatteryIndicatorState } from '../../shared/battery/derive';

export type ViewModel = {
  slug: string;
  time: string;
  date: string;
  // Coarse-bucketed battery state (or null when absent). Lives in the view model
  // so toJsonView carries it into the ETag input — the indicator redraws only
  // when a segment changes or charging toggles, not on every mV drift.
  battery: BatteryIndicatorState | null;
};

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). The ViewModel is a pure DTO, so the projection is the identity —
// a field added to the type can never silently miss the diagnostics view.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
  return { ...vm };
}
