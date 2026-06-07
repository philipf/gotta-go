// Tests for the public_holidays gateway. Drives fetchHolidays through a stub
// KVNamespace built from fixtures.ts. Per ADR-0005 testing posture:
// integration-style through the public interface, no live KV.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHolidays } from './public-holidays';
import { storedHolidays } from './fixtures';

// The gateway only calls get(key, 'json'); everything else is irrelevant to it.
const stubKv = (json: unknown): KVNamespace =>
	({ get: async () => json }) as unknown as KVNamespace;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchHolidays', () => {
	it('drops entries without a string date and keeps the rest', async () => {
		const dates = await fetchHolidays({
			kv: stubKv([
				{ date: '2026-02-06', name: 'Waitangi Day' },
				{ name: 'dateless' },
				{ date: 42, name: 'numeric date' },
				'not an object',
				null,
			]),
		});

		expect(dates).toEqual(new Set(['2026-02-06']));
	});

	it('returns an empty set and logs a warning when the KV read throws', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const throwingKv = {
			get: async () => {
				throw new Error('KV unavailable');
			},
		} as unknown as KVNamespace;

		const dates = await fetchHolidays({ kv: throwingKv });

		expect(dates).toEqual(new Set());
		expect(warn).toHaveBeenCalledOnce();
	});

	it('returns an empty set and logs a warning when the KV key is missing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// kv.get returns null for an absent key.
		const dates = await fetchHolidays({ kv: stubKv(null) });

		expect(dates).toEqual(new Set());
		expect(warn).toHaveBeenCalledOnce();
	});

	it('returns an empty set and logs a warning when the payload is not an array', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const dates = await fetchHolidays({ kv: stubKv({ unexpected: 'object' }) });

		expect(dates).toEqual(new Set());
		expect(warn).toHaveBeenCalledOnce();
	});

	it('maps a stored holiday list into a Set of ISO dates', async () => {
		const dates = await fetchHolidays({ kv: stubKv(storedHolidays) });

		expect(dates).toEqual(
			new Set([
				'2026-01-01',
				'2026-01-19',
				'2026-02-06',
				'2026-06-01',
				'2026-12-25',
				'2027-01-01',
			]),
		);
	});
});
