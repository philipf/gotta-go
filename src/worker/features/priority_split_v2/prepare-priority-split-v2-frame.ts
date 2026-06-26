// Public contract for priority_split_v2: prepare the transit frame with
// rendering deferred. Mirrors v1's REPR contract (issue #102) so the registry
// binder can bind it the same way, while the two folders stay independent.

import type { FetchArrivalsResponse } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';
import type { BatteryIndicatorState } from '../../shared/battery/derive';

export type PreparePrioritySplitV2Frame = (req: PreparePrioritySplitV2FrameRequest) => Promise<PreparePrioritySplitV2FrameResponse>;

export type PreparePrioritySplitV2FrameRequest = {
  // The transit targets to render — one column each, from the resolved phase.
  targets: TransitTarget[];
  // Arrivals for one target; transport (fetch + API key + prediction limit) is
  // bound by the composition root.
  fetchArrivals: ArrivalsSource;
  timezone: string;
  now: Date;
  // The RUN limit for the LAST row's RUN/MISSED split (#104), from the resolved
  // profile phase; absent → the domain default of 1 min.
  runLimitMins?: number;
  // Dev-only dogfooding aid (#108): when true, pad sparse feeds with synthetic
  // future departures so THEN/LATER populate. Set from DEV_PAD_LATER; never true
  // in production. See debug/dev-pad-arrivals.ts.
  padLater?: boolean;
  // The derived battery indicator state, or null when the reading is absent —
  // already mapped from mV by the composition root. null hides the indicator.
  battery: BatteryIndicatorState | null;
  // Artefact flags — format negotiation already collapsed by the caller.
  includeBmp: boolean;
  includeSvg: boolean;
};

export type PreparePrioritySplitV2FrameResponse = {
  view: Record<string, unknown>; // JSON projection — diagnostics + ETag input
  version: number; // appearance revision — ETag input
  render: () => Promise<PrioritySplitV2RenderResult>; // deferred; closes over the private VM
};

export type ArrivalsSource = (target: TransitTarget) => Promise<FetchArrivalsResponse>;

export type PrioritySplitV2RenderResult = {
  frame: Uint8Array | null;
  svg: string | null;
};

export { preparePrioritySplitV2FrameImplementation as preparePrioritySplitV2Frame } from './prepare-priority-split-v2-frame-impl';
