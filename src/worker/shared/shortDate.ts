// "Dow DD Mon" wall-date formatting in an arbitrary timezone; Intl.DateTimeFormat
// memoised per timezone because it is the expensive part.

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
