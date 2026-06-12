// End-to-end tests for the icanhazdadjoke gateway. Drives fetchJoke through a
// stub fetch that returns a real Response built from fixtures.ts. Per ADR-0005
// testing posture: integration-style through the public contract (fetch-joke.ts),
// no live HTTP.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJoke } from './fetch-joke';
import { classicJoke, paddedJoke } from './fixtures';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchJoke', () => {
	it('maps a 200 JSON joke into the domain Joke', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(classicJoke), { status: 200 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({
			ok: true,
			data: { id: classicJoke.id, text: classicJoke.joke },
		});
	});

	it('trims surrounding whitespace from the joke text', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(paddedJoke), { status: 200 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({
			ok: true,
			data: { id: paddedJoke.id, text: 'I only know 25 letters of the alphabet. I dont know y.' },
		});
	});

	it('classifies a non-2xx as an upstream error carrying status + body snippet', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response('upstream boom', { status: 503 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({
			ok: false,
			error: { kind: 'upstream', status: 503, detail: 'upstream boom' },
		});
	});

	it('classifies a thrown fetch (no response) as a network error, preserving the cause', async () => {
		const stubFetch: typeof fetch = async () => {
			throw new Error('connection reset');
		};

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({
			ok: false,
			error: { kind: 'network', detail: 'Error: connection reset' },
		});
	});

	it('treats a 200 with malformed JSON as an upstream error, preserving the parse cause', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response('not json', { status: 200 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toMatchObject({ ok: false, error: { kind: 'upstream', status: 200 } });
		// The exact SyntaxError text is runtime-dependent — assert only that the
		// parse cause survived into `detail`, not its wording.
		if (!result.ok) expect(typeof result.error.detail).toBe('string');
	});

	it('treats a 200 with an empty joke field as an upstream error', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify({ id: 'x', joke: '   ', status: 200 }), { status: 200 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({ ok: false, error: { kind: 'upstream', status: 200 } });
	});
});
