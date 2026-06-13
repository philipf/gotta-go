// Domain service for dual_month_calendar: builds the view model from wall date and holidays —
// two Monday-start month grids; domain-granularity test seam between fetch and derivation.

import type { MonthGrid, ViewModel } from './viewmodel';

// y/m/d extraction in an arbitrary timezone, without a date library — the same
// memoised-per-timezone Intl pattern as shared/hhmm and shared/shortDate (the
// set of timezones is tiny and fixed for a household). Kept in-feature until a
// 2nd consumer appears, per the worker-architecture lift heuristic.
const YMD_FMT = new Map<string, Intl.DateTimeFormat>();

function ymdFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = YMD_FMT.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    YMD_FMT.set(tz, fmt);
  }
  return fmt;
}

function wallDate(now: Date, tz: string): { year: number; month0: number; day: number } {
  const parts = ymdFormatter(tz).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month0: get('month') - 1, day: get('day') };
}

// Header ("Sunday 7 June 2026") and caption ("June 2026") formatters run at
// UTC against a Date anchored to UTC midnight of the wall date, so no further
// timezone handling is needed. Parts are joined manually because en-GB's
// default weekday format inserts a comma ("Sunday, 7 June") we don't want.
const HEADER_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const CAPTION_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

function header(year: number, month0: number, day: number): string {
  const parts = HEADER_FMT.formatToParts(new Date(Date.UTC(year, month0, day)));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

// Monday-start grid for one month. Date.UTC normalises an overflowed month0
// (e.g. 12 = January of the following year), and the day-0 trick yields the
// month length across 28/29/30/31 — including leap-year February.
function monthGrid(year: number, month0: number, todayDay: number | null, holidayDates: Set<string>): MonthGrid {
  const first = new Date(Date.UTC(year, month0, 1));
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  // getUTCDay is Sunday-0; rotate so Monday lands in column 0.
  const leadingBlanks = (first.getUTCDay() + 6) % 7;

  const cells: (number | null)[] = Array(leadingBlanks).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Days in this month that are public holidays: filter the ISO date set by
  // this grid's "YYYY-MM-" prefix, taken from `first` so an overflowed month0
  // (December's next-month grid = January next year) gets the rolled-over
  // year for free.
  const prefix = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-`;
  const holidays = [...holidayDates]
    .filter((date) => date.startsWith(prefix))
    .map((date) => Number(date.slice(prefix.length)))
    .sort((a, b) => a - b);

  return { caption: CAPTION_FMT.format(first), weeks, today: todayDay, holidays };
}

// Assembles the full view model from a wall instant and the already-loaded
// holiday set: the current-date header plus this-month and next-month grids
// (today marked only on the former). Exported as the domain-granularity test
// seam — the fetch + soft-miss path is driven through the prepare capability.
export function buildCalendarViewModel(now: Date, timezone: string, slug: string, holidays: Set<string>): ViewModel {
  const { year, month0, day } = wallDate(now, timezone);
  return {
    slug,
    header: header(year, month0, day),
    months: [monthGrid(year, month0, day, holidays), monthGrid(year, month0 + 1, null, holidays)],
  };
}
