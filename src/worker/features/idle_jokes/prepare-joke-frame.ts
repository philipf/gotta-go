// Public contract for the idle_jokes feature: prepare the joke frame, with
// rendering deferred so the conditional-frame path (ADR-0013) never pays for
// rasterisation. Implementation in prepare-joke-frame-impl.ts; error policy in
// errors.ts (throws a Retryable joke-source-unavailable AppError, ADR-0011).

// FIX: review comment section, as we have potential inaccuracies.  I would also like
// to remove the verbose comments.  Each file should just have the purpose of the file first
// then followed by backed-up comments.
// NOTE: applied across the new idle_jokes files — purpose-first header, then only
// non-obvious constraints; the old buildViewModel/render narration is gone.

// FIX: I want to see a clear interface / types only for this service, similar to what we have done for Gateways
// consider exporting the as idleJokeService  and rename the service.ts to idle-joke-service.ts and the implementation class to idle-joke-service-impl.
// NOTE: resolved — capability-named contract/impl split (ADR-0016 §5). The export
// is the bare function `prepareJokeFrame`, not a service object (decision 5).

// FIX:: Layout needs a clear definition, it is not clear what Layout is at first sight. I also think the public members buildViewModel, toJsonView and render methods
// are not correctly encapsulated, at this point it is a gut feel and I need to better understand if that is really the case and then options to solve it
// NOTE: resolved — the only public surface is this one capability returning
// view/version/render; the view model is private, living inside the deferred closure.

import type { FetchJokeResponse } from '../../gateways/icanhazdadjoke/fetch-joke';

export type PrepareJokeFrame = (
	req: PrepareJokeFrameRequest,
) => Promise<PrepareJokeFrameResponse>;

// FIX: RenderContext is my biggest headache, ideally I would like to have a clear REPR contract, not this RenderContext that contains elements from other services
// NOTE: resolved — this is the feature's own REPR request: a bound JokeSource
// plus the artefact flags it derives from, nothing borrowed from other features.
// FIX: Stop-gap for the RenderContext smell
// NOTE: resolved — JokesContext (the Pick stop-gap) is deleted; the request
// injects exactly what the feature consumes.
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
