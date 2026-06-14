// Public contract for priority_split_v2: prepare the transit frame with
// rendering deferred. Mirrors v1's REPR contract (issue #102) so the registry
// binder can bind it the same way, while the two folders stay independent.

import type { FetchArrivalsResponse } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';

export type PreparePrioritySplitV2Frame = (req: PreparePrioritySplitV2FrameRequest) => Promise<PreparePrioritySplitV2FrameResponse>;

export type PreparePrioritySplitV2FrameRequest = {
  // The transit targets to render — one column each, from the resolved phase.
  targets: TransitTarget[];
  // Arrivals for one target; transport (fetch + API key + prediction limit) is
  // bound by the composition root.
  fetchArrivals: ArrivalsSource;
  timezone: string;
  now: Date;
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
