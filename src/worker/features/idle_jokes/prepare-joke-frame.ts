// Public contract for the idle_jokes feature: prepare the joke frame, with
// rendering deferred so the conditional-frame path (ADR-0013) never pays for
// rasterisation. Implementation in prepare-joke-frame-impl.ts; error policy in
// errors.ts (throws a Retryable joke-source-unavailable AppError, ADR-0011).

import type { FetchJokeResponse } from '../../gateways/icanhazdadjoke/fetch-joke';

export type PrepareJokeFrame = (
	req: PrepareJokeFrameRequest,
) => Promise<PrepareJokeFrameResponse>;

export type PrepareJokeFrameRequest = {
	// The joke source, bound to transport by the composition root.
	fetchJoke: JokeSource;
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
