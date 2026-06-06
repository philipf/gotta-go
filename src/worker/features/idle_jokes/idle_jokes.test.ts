import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildViewModel, toJsonView } from './viewmodel';
import { layout } from './service';
import type { RenderContext } from '../registry';
import { type AppError, RetryableError } from '../../shared/errors';

// Tested at the view-model layer (not the public render()) because the full BMP
// pipeline (Satori → resvg → BMP) is blocked inside the workers-pool sandbox per
// ADR-0005; the rendered frame is exercised end-to-end via `pnpm dev` + curl.
describe('idle_jokes.buildViewModel', () => {
	it('carries the joke text + id through', () => {
		const vm = buildViewModel({ id: 'abc123', text: 'Why did the scarecrow win an award?' });
		expect(vm.text).toBe('Why did the scarecrow win an award?');
		expect(vm.id).toBe('abc123');
	});

	it('gives a longer joke a smaller font than a short one-liner', () => {
		const short = buildViewModel({ id: 's', text: 'I used to hate facial hair, but then it grew on me.' });
		const long = buildViewModel({
			id: 'l',
			text: 'My dog used to chase people on a bike a lot. It got so bad I had to take his bike away. Now he just sits there plotting his revenge in total silence.',
		});
		expect(long.fontSize).toBeLessThan(short.fontSize);
	});

	it('projects the JSON view as { joke, jokeId } only (no render-only fields)', () => {
		const vm = buildViewModel({ id: 'abc123', text: 'A short joke.' });
		expect(toJsonView(vm)).toEqual({ joke: 'A short joke.', jokeId: 'abc123' });
	});
});

// Drives the public two-phase entry (#72) through a stubbed fetch on the
// diagnostics path (format: 'json', includeBmp: false) so it never enters the
// sandbox-blocked Satori/resvg rasteriser. The fetch + error mapping live in
// buildViewModel; render is pure view-model → artefacts.
describe('idle_jokes.layout', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function ctxWith(fetchFn: typeof fetch): RenderContext {
		return {
			radiator: { slug: 'bedroom-philip', profile: { name: 'p', phases: [] } },
			phase: {
				key: 'idle_profile',
				startTime: '00:00',
				endTime: '23:59',
				layout: 'idle_jokes',
				refreshIntervalMinutes: 0,
			},
			timezone: 'Pacific/Auckland',
			stopPredictionLimit: 5,
			now: new Date('2026-05-31T11:00:00Z'),
			format: 'json',
			includeBmp: false,
			env: {} as unknown as RenderContext['env'],
			fetchFn,
		};
	}

	async function buildError(ctx: RenderContext): Promise<AppError> {
		try {
			await layout.buildViewModel(ctx);
		} catch (e) {
			return e as AppError;
		}
		throw new Error('expected buildViewModel() to throw');
	}

	it('builds a joke view model on a successful fetch; render skips both artefacts', async () => {
		const fetchFn: typeof fetch = async () =>
			new Response(JSON.stringify({ id: 'abc', joke: 'A wee joke.', status: 200 }), { status: 200 });
		const ctx = ctxWith(fetchFn);

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
