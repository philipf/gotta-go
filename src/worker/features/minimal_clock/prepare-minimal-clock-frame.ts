// Public contract for minimal_clock: prepare the clock frame with rendering deferred.

import type { BatteryIndicatorState } from '../../shared/battery/derive';

export type PrepareMinimalClockFrame = (req: PrepareMinimalClockFrameRequest) => Promise<PrepareMinimalClockFrameResponse>;

export type PrepareMinimalClockFrameRequest = {
  // The radiator slug, surfaced in the diagnostics view.
  slug: string;
  timezone: string;
  now: Date;
  // The derived battery indicator state, or null when the reading is absent —
  // already mapped from mV by the composition root. null hides the indicator.
  battery: BatteryIndicatorState | null;
  // Artefact flags — format negotiation already collapsed by the caller.
  includeBmp: boolean;
  includeSvg: boolean;
};

export type PrepareMinimalClockFrameResponse = {
  view: Record<string, unknown>; // JSON projection — diagnostics + ETag input
  version: number; // appearance revision — ETag input
  render: () => Promise<MinimalClockRenderResult>; // deferred; closes over the private VM
};

export type MinimalClockRenderResult = {
  frame: Uint8Array | null;
  svg: string | null;
};

export { prepareMinimalClockFrameImplementation as prepareMinimalClockFrame } from './prepare-minimal-clock-frame-impl';
