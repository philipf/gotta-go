import { describe, it, expect } from 'vitest';
import {
	prepareJokeFrame,
	type JokeSource,
	type PrepareJokeFrameRequest,
} from './prepare-joke-frame';
import type { JokeGatewayError } from '../../gateways/icanhazdadjoke/fetch-joke';
import { type AppError, RetryableError } from '../../shared/errors';
import { LAYOUT_VERSION } from './view';

// Drives the public capability with a domain-typed JokeSource — the ADR-0005
// wire quarantine reaches the feature's tests: no Response objects, no wire
// JSON. Both artefact flags off keeps render() out of the sandbox-blocked
// Satori/resvg pipeline (ADR-0005) and proves the deferred closure is safe to
// call on the 304 path.
const jokeSource =
	(id: string, text: string): JokeSource =>
	async () => ({ ok: true, data: { id, text } });

const failingSource =
	(error: JokeGatewayError): JokeSource =>
	async () => ({ ok: false, error });

const requestWith = (fetchJoke: JokeSource): PrepareJokeFrameRequest => ({
	fetchJoke,
	includeBmp: false,
	includeSvg: false,
});

async function prepareError(fetchJoke: JokeSource): Promise<AppError> {
	try {
		await prepareJokeFrame(requestWith(fetchJoke));
	} catch (e) {
		return e as AppError;
	}
	throw new Error('expected prepareJokeFrame() to throw');
}

// NOTE (for review): the old "longer joke ⇒ smaller font" assertion is gone.
// fontSize is now private to the view model inside the deferred render closure;
// the public reads (view, render output) don't expose it, and render() can't run
// in the wasm sandbox. fontSizeFor still executes on every prepare. Option:
// expose fontSizeFor as a named test seam (ADR-0014 escape hatch, cf.
// priority_split's viewModelFromStopStates). Left unimplemented — judged
// acceptable for three fixed buckets; your call.

describe('idle_jokes.prepareJokeFrame', () => {
	it('carries the joke text + id into the view as { joke, jokeId } only', async () => {
		const prepared = await prepareJokeFrame(
			requestWith(jokeSource('abc123', 'Why did the scarecrow win an award?')),
		);

		expect(prepared.view).toEqual({
			joke: 'Why did the scarecrow win an award?',
			jokeId: 'abc123',
		});
	});

	it('reports the view LAYOUT_VERSION as the appearance version', async () => {
		const prepared = await prepareJokeFrame(requestWith(jokeSource('abc', 'A wee joke.')));

		expect(prepared.version).toBe(LAYOUT_VERSION);
	});

	it('defers rendering; with both artefact flags off it resolves to neither', async () => {
		const prepared = await prepareJokeFrame(requestWith(jokeSource('abc', 'A wee joke.')));

		const rendered = await prepared.render();

		expect(rendered.frame).toBeNull();
		expect(rendered.svg).toBeNull();
	});

	it('throws a Retryable joke-source-unavailable 502 on an upstream failure, carrying the snippet', async () => {
		const err = await prepareError(failingSource({ kind: 'upstream', status: 503, detail: 'boom' }));

		expect(err).toBeInstanceOf(RetryableError);
		expect(err.slug).toBe('joke-source-unavailable');
		expect(err.status).toBe(502);
		expect(err.logLevel).toBe('warn');
		expect(err.upstreamDetail).toBe('boom');
	});

	it('throws a Retryable joke-source-unavailable on a network failure (no snippet)', async () => {
		const err = await prepareError(failingSource({ kind: 'network' }));

		expect(err).toBeInstanceOf(RetryableError);
		expect(err.slug).toBe('joke-source-unavailable');
		expect(err.upstreamDetail).toBeUndefined();
	});
});
