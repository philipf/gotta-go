// Public contract for priority_split: prepare the transit frame with rendering deferred.

import type { FetchArrivalsResponse } from '../../gateways/metlink/fetch-arrivals';
import type { TransitTarget } from '../../config/config-types';

export type PreparePrioritySplitFrame = (
	req: PreparePrioritySplitFrameRequest,
) => Promise<PreparePrioritySplitFrameResponse>;

export type PreparePrioritySplitFrameRequest = {
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

export type PreparePrioritySplitFrameResponse = {
	view: Record<string, unknown>; // JSON projection — diagnostics + ETag input
	version: number; // appearance revision — ETag input
	render: () => Promise<PrioritySplitRenderResult>; // deferred; closes over the private VM
};

export type ArrivalsSource = (target: TransitTarget) => Promise<FetchArrivalsResponse>;

export type PrioritySplitRenderResult = {
	frame: Uint8Array | null;
	svg: string | null;
};

export { preparePrioritySplitFrameImplementation as preparePrioritySplitFrame } from './prepare-priority-split-frame-impl';
