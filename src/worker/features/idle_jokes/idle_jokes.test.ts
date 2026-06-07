import { describe, it, expect } from 'vitest';
import { layout, type JokesContext } from './service';
import { type AppError, RetryableError } from '../../shared/errors';

// Drives the public two-phase entry (#72) through a stubbed fetch on the
// diagnostics path (format: 'json', includeBmp: false) so it never enters the
// sandbox-blocked Satori/resvg rasteriser (ADR-0005). JokesContext — the
// layout's declared RenderContext slice — carries exactly the dependencies
// the layout consumes: the outbound fetch and the negotiated format.
const ctxWith = (fetchFn: typeof fetch): JokesContext => ({
	fetchFn,
	format: 'json',
	includeBmp: false,
});

const jokeFetch = (id: string, joke: string): typeof fetch =>
	async () => new Response(JSON.stringify({ id, joke, status: 200 }), { status: 200 });

async function buildError(ctx: JokesContext): Promise<AppError> {
	try {
		await layout.buildViewModel(ctx);
	} catch (e) {
		return e as AppError;
	}
	throw new Error('expected buildViewModel() to throw');
}

describe('idle_jokes.layout', () => {
	it('carries the joke text + id through to the view model', async () => {
		const vm = await layout.buildViewModel(
			ctxWith(jokeFetch('abc123', 'Why did the scarecrow win an award?')),
		);

		expect(vm.text).toBe('Why did the scarecrow win an award?');
		expect(vm.id).toBe('abc123');
	});

	it('gives a longer joke a smaller font than a short one-liner', async () => {
		const short = await layout.buildViewModel(
			ctxWith(jokeFetch('s', 'I used to hate facial hair, but then it grew on me.')),
		);
		const long = await layout.buildViewModel(
			ctxWith(
				jokeFetch(
					'l',
					'My dog used to chase people on a bike a lot. It got so bad I had to take his bike away. Now he just sits there plotting his revenge in total silence.',
				),
			),
		);

		expect(long.fontSize).toBeLessThan(short.fontSize);
	});

	it('projects the JSON view as { joke, jokeId } only (no render-only fields)', async () => {
		const vm = await layout.buildViewModel(ctxWith(jokeFetch('abc123', 'A short joke.')));

		expect(layout.toJsonView(vm)).toEqual({ joke: 'A short joke.', jokeId: 'abc123' });
	});

	it('builds a joke view model on a successful fetch; render skips both artefacts', async () => {
		const ctx = ctxWith(jokeFetch('abc', 'A wee joke.'));

		const vm = await layout.buildViewModel(ctx);
		const result = await layout.render(vm, ctx);

		expect(result.frame).toBeNull();
		expect(result.svg).toBeNull();
		expect(layout.toJsonView(vm)).toEqual({ joke: 'A wee joke.', jokeId: 'abc' });
	});

	it('throws a Retryable joke-source-unavailable 502 on a non-2xx, carrying the snippet', async () => {
		const fetchFn: typeof fetch = async () => new Response('boom', { status: 503 });

		const err = await buildError(ctxWith(fetchFn));

		expect(err).toBeInstanceOf(RetryableError);
		expect(err.slug).toBe('joke-source-unavailable');
		expect(err.status).toBe(502);
		expect(err.logLevel).toBe('warn');
		expect(err.upstreamDetail).toBe('boom');
	});

	it('throws a Retryable joke-source-unavailable on a network failure (no snippet)', async () => {
		const fetchFn: typeof fetch = async () => {
			throw new TypeError('connection refused');
		};

		const err = await buildError(ctxWith(fetchFn));

		expect(err).toBeInstanceOf(RetryableError);
		expect(err.slug).toBe('joke-source-unavailable');
		expect(err.upstreamDetail).toBeUndefined();
	});
});
