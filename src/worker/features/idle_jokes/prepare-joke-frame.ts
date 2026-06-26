// Public contract for idle_jokes: prepare the joke frame with rendering deferred.

import type { FetchJokeResponse } from '../../gateways/icanhazdadjoke/fetch-joke';
import type { BatteryIndicatorState } from '../../shared/battery/derive';

export type PrepareJokeFrame = (req: PrepareJokeFrameRequest) => Promise<PrepareJokeFrameResponse>;

export type PrepareJokeFrameRequest = {
  // The joke source, bound to transport by the composition root.
  fetchJoke: JokeSource;
  // The derived battery indicator state, or null when the reading is absent —
  // already mapped from mV by the composition root. null hides the indicator.
  battery: BatteryIndicatorState | null;
  // Artefact flags — format negotiation already collapsed by the caller.
  includeBmp: boolean;
  includeSvg: boolean;
};

export type PrepareJokeFrameResponse = {
  view: Record<string, unknown>; // JSON projection — diagnostics + ETag input
  version: number; // appearance revision — ETag input
  render: () => Promise<JokeRenderResult>; // deferred; closes over the private VM
};

export type JokeSource = () => Promise<FetchJokeResponse>;

export type JokeRenderResult = {
  frame: Uint8Array | null;
  svg: string | null;
};

export { prepareJokeFrameImplementation as prepareJokeFrame } from './prepare-joke-frame-impl';
