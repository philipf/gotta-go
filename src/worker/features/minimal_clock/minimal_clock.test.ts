import { describe, it, expect } from 'vitest';
import { layout, type ClockContext } from './service';

// Drives the public buildViewModel(ctx) phase via the layout's declared
// RenderContext slice — exactly the dependencies the layout consumes, nothing
// else. The render(vm, ctx) phase (Satori → resvg → BMP) is wasm-blocked in
// the workers-pool sandbox per ADR-0005 and is exercised via `pnpm dev` + curl.
const ctxAt = (iso: string, tz = 'Pacific/Auckland'): ClockContext => ({
	radiator: { slug: 'bedroom-philip-tania' },
	timezone: tz,
	now: new Date(iso),
	format: 'json',
	includeBmp: false,
});

describe('minimal_clock.layout.buildViewModel', () => {
	it('returns slug + HH:MM time + "Dow DD Mon" date in the supplied timezone', async () => {
		// 2026-05-23T06:48:00Z = 2026-05-23T18:48:00+12:00 (Pacific/Auckland)
		const vm = await layout.buildViewModel(ctxAt('2026-05-23T06:48:00Z'));

		expect(vm.slug).toBe('bedroom-philip-tania');
		expect(vm.time).toMatch(/^\d{2}:\d{2}$/);
		expect(vm.date).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
	});
});
