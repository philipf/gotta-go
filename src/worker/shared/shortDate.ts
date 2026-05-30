// "Dow DD Mon" wall-date formatting in an arbitrary timezone, without a date
// library — the date sibling of shared/hhmm. The Intl.DateTimeFormat is the
// expensive part, so it is memoised per timezone (the set of timezones is tiny
// and fixed for a household). en-GB gives the short weekday/month forms; we join
// the parts ourselves because en-GB's default format inserts a comma
// ("Sat, 31 May") we don't want. Lifted out of minimal_clock per the
// worker-architecture heuristic when priority_split became the 2nd consumer
// (the same move that produced shared/hhmm).

const FMT = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
	let fmt = FMT.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			weekday: 'short',
			day: 'numeric',
			month: 'short',
		});
		FMT.set(tz, fmt);
	}
	return fmt;
}

export function shortDate(date: Date, tz: string): string {
	const parts = formatter(tz).formatToParts(date);
	const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
	const dd = parts.find((p) => p.type === 'day')?.value ?? '';
	const mn = parts.find((p) => p.type === 'month')?.value ?? '';
	return `${wd} ${dd} ${mn}`;
}
