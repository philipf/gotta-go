// Data contract for idle_jokes: the format-agnostic ViewModel and its JSON projection.

import type { BatteryIndicatorState } from '../../shared/battery/derive';

export type ViewModel = {
  text: string;
  id: string;
  // Coarse-bucketed battery state (or null when absent). Carried into toJsonView
  // so it folds into the ETag input — the indicator redraws only when a segment
  // changes or charging toggles, not on every mV drift.
  battery: BatteryIndicatorState | null;
};

// Serialises the view model for the JSON diagnostics envelope (ADR-0004). A
// real projection: text + id map onto the glossary wire names. Font sizing is a
// view concern (view.tsx), so it never reached the wire view anyway.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
  return { joke: vm.text, jokeId: vm.id, battery: vm.battery };
}
