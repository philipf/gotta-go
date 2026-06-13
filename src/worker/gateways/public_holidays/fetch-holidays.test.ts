// Tests for the public_holidays gateway. Drives fetchHolidays through a stub
// KVNamespace built from fixtures.ts. Per ADR-0005 testing posture:
// integration-style through the public contract (fetch-holidays.ts), no live KV.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHolidays } from './fetch-holidays';
import { storedHolidays } from './fixtures';

// The gateway only calls get(key, 'json'); everything else is irrelevant to it.
const stubKv = (json: unknown): KVNamespace => ({ get: async () => json }) as unknown as KVNamespace;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchHolidays', () => {
  it('maps a stored holiday list into a Set of ISO dates', async () => {
    const result = await fetchHolidays({ kv: stubKv(storedHolidays) });

    expect(result).toEqual({
      ok: true,
      data: new Set(['2026-01-01', '2026-01-19', '2026-02-06', '2026-06-01', '2026-12-25', '2027-01-01']),
    });
  });

  it('drops entries without a string date and keeps the rest', async () => {
    const result = await fetchHolidays({
      kv: stubKv([
        { date: '2026-02-06', name: 'Waitangi Day' },
        { name: 'dateless' },
        { date: 42, name: 'numeric date' },
        'not an object',
        null,
      ]),
    });

    expect(result).toEqual({ ok: true, data: new Set(['2026-02-06']) });
  });

  it('returns an unavailable error, without logging, when the KV read throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingKv = {
      get: async () => {
        throw new Error('KV unavailable');
      },
    } as unknown as KVNamespace;

    const result = await fetchHolidays({ kv: throwingKv });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', detail: 'Error: KV unavailable' },
    });
    // Side-effect-free bulkhead (ADR-0005): the caller logs, not the gateway.
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns an invalid error when the KV key is missing', async () => {
    // kv.get returns null for an absent key.
    const result = await fetchHolidays({ kv: stubKv(null) });

    expect(result).toEqual({ ok: false, error: { kind: 'invalid', detail: 'key missing' } });
  });

  it('returns an invalid error when the payload is not an array', async () => {
    const result = await fetchHolidays({ kv: stubKv({ unexpected: 'object' }) });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid', detail: 'payload is not an array' },
    });
  });
});
