// test- scenario slug tests (GH #21): the synthetic resolver in isolation, and
// the full route through handleTestFrame. End-to-end requests negotiate JSON
// (Accept: application/json) so they exercise routing + phase resolution without
// the Satori → resvg BMP pipeline, which the workers-pool sandbox blocks
// (ADR-0005, mirrored by api.test.ts). priority_split scenarios hit Metlink, so
// fetch is stubbed with a closed-stop fixture for determinism.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from './router';
import { resolveTestRadiator } from './test-frame';
import { closedStop } from '../gateways/metlink/fixtures';

const TOKEN = 'test-token-123';
const env = { RADIATOR_SHARED_TOKEN: TOKEN, METLINK_API_KEY: 'test-key' } as Env;

function frameReq(slug: string): Request {
	return new Request('http://localhost/v1/frame', {
		headers: {
			'X-Radiator-Slug': slug,
			'X-Radiator-Token': TOKEN,
			Accept: 'application/json',
		},
	});
}

describe('resolveTestRadiator', () => {
	it('resolves test-<phaseKey> to a synthetic all-day radiator', () => {
		const r = resolveTestRadiator('test-all_day_clock');
		expect(r?.slug).toBe('test-all_day_clock');
		// profile.name carries the originating profile's name.
		expect(r?.profile.name).toBe('philip_and_tania');
		expect(r?.profile.phases).toHaveLength(1);
		const phase = r!.profile.phases[0];
		expect(phase.key).toBe('all_day_clock');
		expect(phase.layout).toBe('minimal_clock');
		// Widened to the half-open full day so resolveProfilePhase always matches.
		expect(phase.startTime).toBe('00:00');
		expect(phase.endTime).toBe('24:00');
	});

	it('finds a phase in any profile, reusing its transit targets', () => {
		const r = resolveTestRadiator('test-morning_school_run');
		expect(r?.profile.name).toBe('daughter_school');
		expect(r?.profile.phases[0].layout).toBe('priority_split');
		expect(r?.profile.phases[0].transitTargets).toBeDefined();
	});

	it('returns undefined for an unknown phase key', () => {
		expect(resolveTestRadiator('test-nope')).toBeUndefined();
	});

	it('returns undefined when the test- prefix is absent', () => {
		expect(resolveTestRadiator('all_day_clock')).toBeUndefined();
	});
});

describe('GET /v1/frame with a test- slug', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders the named offline phase regardless of wall-clock time', async () => {
		// Noon and midnight both render minimal_clock — the phase is all-day, so
		// it never falls back to a different phase the way a real slug would.
		for (const iso of ['2026-05-30T12:00:00Z', '2026-05-30T00:00:00Z']) {
			const res = await route(frameReq('test-all_day_clock'), env, new Date(iso));
			expect(res.status).toBe(200);
			expect(res.headers.get('X-Profile-Phase')).toBe('all_day_clock');
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.layout).toBe('minimal_clock');
		}
	});

	it('routes a priority_split scenario through the same core', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(closedStop), { status: 200 })),
		);
		const res = await route(
			frameReq('test-morning_commute'),
			env,
			// Mid-afternoon — outside the real 06:30–09:00 window, proving the
			// scenario slug is decoupled from wall-clock phase selection.
			new Date('2026-05-30T03:00:00Z'),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Profile-Phase')).toBe('morning_commute');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.layout).toBe('priority_split');
	});

	it('404s an unknown test- phase key', async () => {
		const res = await route(frameReq('test-nope'), env, new Date());
		expect(res.status).toBe(404);
	});
});
