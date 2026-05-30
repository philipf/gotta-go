// 24-hour "HH:MM" wall-clock formatting in an arbitrary timezone, without a date
// library. The Intl.DateTimeFormat is the expensive part, so it is memoised per
// timezone (the set of timezones is tiny and fixed for a household). en-GB gives
// 24-hour HH:MM by default. Callers that need minutes-since-midnight derive them
// by splitting the string, so this is the single source of the formatter the
// viewmodels and schedule/resolve all shared before (lifted per the
// worker-architecture heuristic: a helper a 2nd feature needs leaves the slice).

const FMT = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
	let fmt = FMT.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		FMT.set(tz, fmt);
	}
	return fmt;
}

export function hhmm(date: Date, tz: string): string {
	return formatter(tz).format(date);
}
