// Public interface for the icanhazdadjoke gateway. Composes client.ts (HTTP)
// and mapper.ts (wire→domain), exposing the domain-shaped Joke only — callers
// never see wire field names. Per ADR-0005 §Gateways, this file is the bulkhead
// between the upstream wire format and the rest of the Worker.
//
// The error surface is deliberately coarse: idle content has no auth key and no
// per-status policy (the caller maps every failure to one problem type — #17),
// so a failed fetch is just `network` (no HTTP response) or `upstream`
// (non-2xx, or a 2xx with an unusable body).

import { fetchRandomJoke } from './client';
import { toJoke } from './mapper';
import type { WireJoke } from './types';
import { MAX_SNIPPET } from '../../shared/errors';

export type Joke = {
	id: string;
	text: string;
};

export type GatewayError =
	| { kind: 'upstream'; status: number; detail?: string }
	| { kind: 'network' };

export type FetchResult =
	| { ok: true; data: Joke }
	| { ok: false; error: GatewayError };

export type FetchJokeRequest = {
	fetch: typeof fetch;
};

// Reads the error response body once and truncates it for `detail`. Returns
// undefined for an empty body so the field drops out of the log entirely. The
// 2 KB cap is shared with the wire `upstream_detail` member (ADR-0011 / #55).
async function bodySnippet(response: Response): Promise<string | undefined> {
	const body = await response.text();
	if (!body) return undefined;
	return body.length > MAX_SNIPPET ? body.slice(0, MAX_SNIPPET) : body;
}

export async function fetchJoke(req: FetchJokeRequest): Promise<FetchResult> {
	let response: Response;
	try {
		response = await fetchRandomJoke({ fetch: req.fetch });
	} catch {
		return { ok: false, error: { kind: 'network' } };
	}

	if (!response.ok) {
		const detail = await bodySnippet(response);
		return { ok: false, error: { kind: 'upstream', status: response.status, detail } };
	}

	let json: WireJoke;
	try {
		json = (await response.json()) as WireJoke;
	} catch {
		return { ok: false, error: { kind: 'upstream', status: response.status } };
	}

	// A 2xx with no usable joke text is as useless as a 5xx — treat it as
	// upstream so the caller renders the error path rather than an empty frame.
	if (typeof json.joke !== 'string' || json.joke.trim() === '') {
		return { ok: false, error: { kind: 'upstream', status: response.status } };
	}

	return { ok: true, data: toJoke(json) };
}
