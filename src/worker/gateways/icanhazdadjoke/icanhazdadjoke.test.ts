// End-to-end tests for the icanhazdadjoke gateway. Drives fetchJoke through a
// stub fetch that returns a real Response built from fixtures.ts. Per ADR-0005
// testing posture: integration-style through the public interface, no live HTTP.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJoke } from './icanhazdadjoke';
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

	it('classifies a thrown fetch (no response) as a network error', async () => {
		const stubFetch: typeof fetch = async () => {
			throw new Error('connection reset');
		};

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({ ok: false, error: { kind: 'network' } });
	});

	it('treats a 200 with malformed JSON as an upstream error', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response('not json', { status: 200 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({ ok: false, error: { kind: 'upstream', status: 200 } });
	});

	it('treats a 200 with an empty joke field as an upstream error', async () => {
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify({ id: 'x', joke: '   ', status: 200 }), { status: 200 });

		const result = await fetchJoke({ fetch: stubFetch });

		expect(result).toEqual({ ok: false, error: { kind: 'upstream', status: 200 } });
	});
});
