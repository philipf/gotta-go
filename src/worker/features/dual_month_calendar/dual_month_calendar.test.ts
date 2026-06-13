import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildCalendarViewModel } from './domain-service';
import type { ViewModel } from './viewmodel';
import { LAYOUT_VERSION } from './view';
import {
  prepareDualMonthCalendarFrame,
  type HolidaySource,
  type PrepareDualMonthCalendarFrameRequest,
} from './prepare-dual-month-calendar-frame';
import type { HolidaysGatewayError } from '../../gateways/public_holidays/fetch-holidays';
import { storedHolidays } from '../../gateways/public_holidays/fixtures';

// The date math and holiday mapping are specified against the domain seam
// buildCalendarViewModel (see domain-service.ts): it takes the already-loaded
// holiday set, so these cases drive pure JS with no gateway stub. The fetch +
// soft-miss path is driven through the public prepareDualMonthCalendarFrame
// (last describe block) with a domain-typed HolidaySource. The render path
// (Satori → resvg → BMP) is wasm-blocked in the workers-pool sandbox per
// ADR-0005 and is exercised via `pnpm dev` + curl.

const holidaySet = (...dates: string[]): Set<string> => new Set(dates);

const vmAt = (iso: string, tz = 'Pacific/Auckland', holidays: Set<string> = new Set()): ViewModel =>
  buildCalendarViewModel(new Date(iso), tz, 'office-philip', holidays);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dual_month_calendar.buildCalendarViewModel', () => {
  it('returns slug, full-date header, and this/next month captions', () => {
    // 2026-06-07T00:00:00Z = 2026-06-07T12:00+12:00 (NZST)
    const vm = vmAt('2026-06-07T00:00:00Z');

    expect(vm.slug).toBe('office-philip');
    expect(vm.header).toBe('Sunday 7 June 2026');
    expect(vm.months[0].caption).toBe('June 2026');
    expect(vm.months[1].caption).toBe('July 2026');
  });

  it('aligns Monday-start grids with correct leading blanks', () => {
    const vm = vmAt('2026-06-07T00:00:00Z');

    // June 1 2026 is a Monday — no leading blanks.
    expect(vm.months[0].weeks[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // July 1 2026 is a Wednesday — two leading blanks.
    expect(vm.months[1].weeks[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
  });

  it('marks today only in the this-month grid', () => {
    const vm = vmAt('2026-06-07T00:00:00Z');

    expect(vm.months[0].today).toBe(7);
    expect(vm.months[1].today).toBeNull();
  });

  it('keeps every week exactly 7 cells and the day count matching the month length', () => {
    const vm = vmAt('2026-06-07T00:00:00Z');

    for (const month of vm.months) {
      for (const week of month.weeks) expect(week).toHaveLength(7);
    }
    const days = (weeks: (number | null)[][]) => weeks.flat().filter((d) => d !== null);
    expect(days(vm.months[0].weeks)).toHaveLength(30); // June
    expect(days(vm.months[1].weeks)).toHaveLength(31); // July
  });

  it('rolls December over to January of the following year', () => {
    // 2026-12-15T00:00:00Z = 2026-12-15T13:00+13:00 (NZDT)
    const vm = vmAt('2026-12-15T00:00:00Z');

    expect(vm.months[0].caption).toBe('December 2026');
    expect(vm.months[1].caption).toBe('January 2027');
    // Jan 1 2027 is a Friday — four leading blanks.
    expect(vm.months[1].weeks[0]).toEqual([null, null, null, null, 1, 2, 3]);
  });

  it('handles leap-year February', () => {
    const vm = vmAt('2028-02-10T00:00:00Z', 'UTC');

    expect(vm.months[0].caption).toBe('February 2028');
    const days = vm.months[0].weeks.flat().filter((d) => d !== null);
    expect(days).toHaveLength(29);
    // Feb 1 2028 is a Tuesday — one leading blank.
    expect(vm.months[0].weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6]);
  });

  it('handles non-leap February with a near-full leading blank row', () => {
    const vm = vmAt('2026-02-10T00:00:00Z', 'UTC');

    const days = vm.months[0].weeks.flat().filter((d) => d !== null);
    expect(days).toHaveLength(28);
    // Feb 1 2026 is a Sunday — six leading blanks under a Monday start.
    expect(vm.months[0].weeks[0]).toEqual([null, null, null, null, null, null, 1]);
  });

  it('derives the wall date in the configured timezone, not UTC', () => {
    // 2026-06-07T13:00:00Z is already Monday 8 June in Pacific/Auckland (+12).
    const nz = vmAt('2026-06-07T13:00:00Z');
    expect(nz.header).toBe('Monday 8 June 2026');
    expect(nz.months[0].today).toBe(8);

    const utc = vmAt('2026-06-07T13:00:00Z', 'UTC');
    expect(utc.header).toBe('Sunday 7 June 2026');
    expect(utc.months[0].today).toBe(7);
  });

  it('maps holiday dates to day numbers in their own month grid', () => {
    // King's Birthday in the displayed June, Matariki-ish date in July.
    const vm = vmAt('2026-06-07T00:00:00Z', 'Pacific/Auckland', holidaySet('2026-06-01', '2026-07-10'));

    expect(vm.months[0].holidays).toEqual([1]);
    expect(vm.months[1].holidays).toEqual([10]);
  });

  it('ignores holiday dates outside the two displayed months', () => {
    const vm = vmAt('2026-06-07T00:00:00Z', 'Pacific/Auckland', holidaySet('2026-02-06', '2026-08-01', '2027-06-01'));

    expect(vm.months[0].holidays).toEqual([]);
    expect(vm.months[1].holidays).toEqual([]);
  });

  it("shows next January's holidays in the December next-month grid", () => {
    const vm = vmAt('2026-12-15T00:00:00Z', 'Pacific/Auckland', holidaySet('2026-12-25', '2027-01-01', '2026-01-01'));

    expect(vm.months[0].caption).toBe('December 2026');
    expect(vm.months[0].holidays).toEqual([25]);
    // January 2027, not the stale January 2026 entry.
    expect(vm.months[1].holidays).toEqual([1]);
  });

  it('crosses the year boundary in the configured timezone ahead of UTC', () => {
    // 2026-12-31T13:00:00Z = 2027-01-01T02:00+13:00 (NZDT) — already next year.
    const vm = vmAt('2026-12-31T13:00:00Z');

    expect(vm.header).toBe('Friday 1 January 2027');
    expect(vm.months[0].caption).toBe('January 2027');
    expect(vm.months[0].today).toBe(1);
    expect(vm.months[1].caption).toBe('February 2027');
  });
});

// Drives the public capability through a domain-typed HolidaySource so the
// sandbox-blocked BMP pipeline is never reached while the #84 soft-miss runs for
// real. The KV read + wire→Set mapping is the gateway's own concern
// (fetch-holidays.test.ts); here the source already speaks Set<string>.
describe('dual_month_calendar.prepareDualMonthCalendarFrame', () => {
  const succeedingSource =
    (data: Set<string>): HolidaySource =>
    async () => ({ ok: true, data });

  const failingSource =
    (error: HolidaysGatewayError): HolidaySource =>
    async () => ({ ok: false, error });

  function requestWith(fetchHolidays: HolidaySource): PrepareDualMonthCalendarFrameRequest {
    return {
      fetchHolidays,
      slug: 'office-philip',
      timezone: 'Pacific/Auckland',
      now: new Date('2026-06-07T00:00:00Z'),
      includeBmp: false,
      includeSvg: false,
    };
  }

  it('degrades to an unshaded calendar when the holidays source fails (#84 soft-miss)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const prepared = await prepareDualMonthCalendarFrame(requestWith(failingSource({ kind: 'unavailable', detail: 'KV down' })));
    const view = prepared.view as unknown as ViewModel;

    // No throw — the calendar still renders, just unshaded.
    expect(view.months[0].holidays).toEqual([]);
    expect(view.months[1].holidays).toEqual([]);
    // The soft-miss is logged by the caller (the gateway is side-effect-free).
    expect(warn).toHaveBeenCalledOnce();
  });

  it('flows the fetched holiday set through to the view model', async () => {
    // June 2026: fixtures hold King's Birthday (2026-06-01); July has none.
    const prepared = await prepareDualMonthCalendarFrame(requestWith(succeedingSource(new Set(storedHolidays.map((h) => h.date)))));
    const view = prepared.view as unknown as ViewModel;

    expect(view.months[0].holidays).toEqual([1]);
    expect(view.months[1].holidays).toEqual([]);
  });

  it('defers rendering - render() with both artefact flags false yields neither artefact', async () => {
    const prepared = await prepareDualMonthCalendarFrame(requestWith(succeedingSource(new Set())));

    expect(prepared.version).toBe(LAYOUT_VERSION);
    await expect(prepared.render()).resolves.toEqual({ frame: null, svg: null });
  });
});
