import { describe, it, expect } from 'vitest';
import { prepareMinimalClockFrame, type PrepareMinimalClockFrameRequest } from './prepare-minimal-clock-frame';
import type { ViewModel } from './viewmodel';
import { LAYOUT_VERSION } from './view';

// Drives the public capability — no external fetch, so the request is pure
// inputs. The render() path (Satori → resvg → BMP) is wasm-blocked in the
// workers-pool sandbox per ADR-0005 and is exercised via `pnpm dev` + curl.
const requestAt = (iso: string, tz = 'Pacific/Auckland'): PrepareMinimalClockFrameRequest => ({
  slug: 'bedroom-philip-tania',
  timezone: tz,
  now: new Date(iso),
  includeBmp: false,
  includeSvg: false,
});

describe('minimal_clock.prepareMinimalClockFrame', () => {
  it('returns slug + HH:MM time + "Dow DD Mon" date in the supplied timezone', async () => {
    // 2026-05-23T06:48:00Z = 2026-05-23T18:48:00+12:00 (Pacific/Auckland)
    const prepared = await prepareMinimalClockFrame(requestAt('2026-05-23T06:48:00Z'));
    const view = prepared.view as unknown as ViewModel;

    expect(view.slug).toBe('bedroom-philip-tania');
    expect(view.time).toMatch(/^\d{2}:\d{2}$/);
    expect(view.date).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
  });

  it('defers rendering - render() with both artefact flags false yields neither artefact', async () => {
    const prepared = await prepareMinimalClockFrame(requestAt('2026-05-23T06:48:00Z'));

    expect(prepared.version).toBe(LAYOUT_VERSION);
    await expect(prepared.render()).resolves.toEqual({ frame: null, svg: null });
  });
});
