// Lowercase 3-letter weekday token ("mon".."sun") for an instant in an arbitrary
// timezone, without a date library — the day-of-week counterpart to hhmm. The
// Intl.DateTimeFormat is the expensive part, so it is memoised per timezone (the
// set of timezones is tiny and fixed for a household). en-US `weekday: 'short'`
// is stable ASCII ("Mon", "Tue", …); lowercasing and slicing to three chars
// lands directly on the Weekday config tokens, so callers compare with a plain
// `days.includes(weekday(now, tz))`. DST never shifts the calendar day, so this
// is day-correct year round even on a switch day.

import type { Weekday } from '../config/types';

const FMT = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
	let fmt = FMT.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			weekday: 'short',
		});
		FMT.set(tz, fmt);
	}
	return fmt;
}

export function weekday(date: Date, tz: string): Weekday {
	return formatter(tz).format(date).toLowerCase().slice(0, 3) as Weekday;
}
