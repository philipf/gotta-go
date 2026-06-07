import { describe, it, expect } from 'vitest';
import { layout } from './service';
import type { RenderContext } from '../registry';
import type { Radiator } from '../../config/lookup';
import { storedHolidays } from '../../gateways/public_holidays/fixtures';

const seedRadiator: Radiator = {
	slug: 'office-philip',
	profile: {
		name: 'philip_office',
		phases: [
			{
				key: 'daytime_calendar',
				startTime: '00:00',
				endTime: '23:59',
				layout: 'dual_month_calendar',
				refreshIntervalMinutes: 240,
			},
		],
	},
};

// Every test drives the public buildViewModel(ctx) phase — pure JS plus a
// stubbed PUBLIC_HOLIDAYS KV binding holding the stored { date, name } shape
// (#84). The render(vm, ctx) phase (Satori → resvg → BMP) is wasm-blocked in
// the workers-pool sandbox per ADR-0005 and is exercised via `pnpm dev` + curl.
type StoredHolidays = { date: string; name: string }[];

const ctxAt = (iso: string, tz = 'Pacific/Auckland', holidays: StoredHolidays = []): RenderContext => ({
	radiator: seedRadiator,
	phase: seedRadiator.profile.phases[0],
	timezone: tz,
	stopPredictionLimit: 10,
	now: new Date(iso),
	format: 'json',
	includeBmp: false,
	env: {
		PUBLIC_HOLIDAYS: { get: async () => holidays },
	} as unknown as Env,
	fetchFn: fetch,
});

const vmAt = (iso: string, tz?: string, holidays?: StoredHolidays) =>
	layout.buildViewModel(ctxAt(iso, tz, holidays));

const holidaysOn = (...dates: string[]): StoredHolidays =>
	dates.map((date) => ({ date, name: 'Holiday' }));

describe('dual_month_calendar.layout.buildViewModel', () => {
	it('fetches holidays from the PUBLIC_HOLIDAYS binding into the view model', async () => {
		// June 2026: fixtures hold King's Birthday (2026-06-01); July has none.
		const vm = await vmAt('2026-06-07T00:00:00Z', 'Pacific/Auckland', storedHolidays);

		expect(vm.months[0].holidays).toEqual([1]);
		expect(vm.months[1].holidays).toEqual([]);
	});

	it('returns slug, full-date header, and this/next month captions', async () => {
		// 2026-06-07T00:00:00Z = 2026-06-07T12:00+12:00 (NZST)
		const vm = await vmAt('2026-06-07T00:00:00Z');

		expect(vm.slug).toBe('office-philip');
		expect(vm.header).toBe('Sunday 7 June 2026');
		expect(vm.months[0].caption).toBe('June 2026');
		expect(vm.months[1].caption).toBe('July 2026');
	});

	it('aligns Monday-start grids with correct leading blanks', async () => {
		const vm = await vmAt('2026-06-07T00:00:00Z');

		// June 1 2026 is a Monday — no leading blanks.
		expect(vm.months[0].weeks[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
		// July 1 2026 is a Wednesday — two leading blanks.
		expect(vm.months[1].weeks[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
	});

	it('marks today only in the this-month grid', async () => {
		const vm = await vmAt('2026-06-07T00:00:00Z');

		expect(vm.months[0].today).toBe(7);
		expect(vm.months[1].today).toBeNull();
	});

	it('keeps every week exactly 7 cells and the day count matching the month length', async () => {
		const vm = await vmAt('2026-06-07T00:00:00Z');

		for (const month of vm.months) {
			for (const week of month.weeks) expect(week).toHaveLength(7);
		}
		const days = (weeks: (number | null)[][]) => weeks.flat().filter((d) => d !== null);
		expect(days(vm.months[0].weeks)).toHaveLength(30); // June
		expect(days(vm.months[1].weeks)).toHaveLength(31); // July
	});

	it('rolls December over to January of the following year', async () => {
		// 2026-12-15T00:00:00Z = 2026-12-15T13:00+13:00 (NZDT)
		const vm = await vmAt('2026-12-15T00:00:00Z');

		expect(vm.months[0].caption).toBe('December 2026');
		expect(vm.months[1].caption).toBe('January 2027');
		// Jan 1 2027 is a Friday — four leading blanks.
		expect(vm.months[1].weeks[0]).toEqual([null, null, null, null, 1, 2, 3]);
	});

	it('handles leap-year February', async () => {
		const vm = await vmAt('2028-02-10T00:00:00Z', 'UTC');

		expect(vm.months[0].caption).toBe('February 2028');
		const days = vm.months[0].weeks.flat().filter((d) => d !== null);
		expect(days).toHaveLength(29);
		// Feb 1 2028 is a Tuesday — one leading blank.
		expect(vm.months[0].weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6]);
	});

	it('handles non-leap February with a near-full leading blank row', async () => {
		const vm = await vmAt('2026-02-10T00:00:00Z', 'UTC');

		const days = vm.months[0].weeks.flat().filter((d) => d !== null);
		expect(days).toHaveLength(28);
		// Feb 1 2026 is a Sunday — six leading blanks under a Monday start.
		expect(vm.months[0].weeks[0]).toEqual([null, null, null, null, null, null, 1]);
	});

	it('derives the wall date in the configured timezone, not UTC', async () => {
		// 2026-06-07T13:00:00Z is already Monday 8 June in Pacific/Auckland (+12).
		const nz = await vmAt('2026-06-07T13:00:00Z');
		expect(nz.header).toBe('Monday 8 June 2026');
		expect(nz.months[0].today).toBe(8);

		const utc = await vmAt('2026-06-07T13:00:00Z', 'UTC');
		expect(utc.header).toBe('Sunday 7 June 2026');
		expect(utc.months[0].today).toBe(7);
	});

	it('maps holiday dates to day numbers in their own month grid', async () => {
		// King's Birthday in the displayed June, Matariki-ish date in July.
		const vm = await vmAt(
			'2026-06-07T00:00:00Z',
			'Pacific/Auckland',
			holidaysOn('2026-06-01', '2026-07-10'),
		);

		expect(vm.months[0].holidays).toEqual([1]);
		expect(vm.months[1].holidays).toEqual([10]);
	});

	it('ignores holiday dates outside the two displayed months', async () => {
		const vm = await vmAt(
			'2026-06-07T00:00:00Z',
			'Pacific/Auckland',
			holidaysOn('2026-02-06', '2026-08-01', '2027-06-01'),
		);

		expect(vm.months[0].holidays).toEqual([]);
		expect(vm.months[1].holidays).toEqual([]);
	});

	it("shows next January's holidays in the December next-month grid", async () => {
		const vm = await vmAt(
			'2026-12-15T00:00:00Z',
			'Pacific/Auckland',
			holidaysOn('2026-12-25', '2027-01-01', '2026-01-01'),
		);

		expect(vm.months[0].caption).toBe('December 2026');
		expect(vm.months[0].holidays).toEqual([25]);
		// January 2027, not the stale January 2026 entry.
		expect(vm.months[1].holidays).toEqual([1]);
	});

	it('crosses the year boundary in the configured timezone ahead of UTC', async () => {
		// 2026-12-31T13:00:00Z = 2027-01-01T02:00+13:00 (NZDT) — already next year.
		const vm = await vmAt('2026-12-31T13:00:00Z');

		expect(vm.header).toBe('Friday 1 January 2027');
		expect(vm.months[0].caption).toBe('January 2027');
		expect(vm.months[0].today).toBe(1);
		expect(vm.months[1].caption).toBe('February 2027');
	});
});
