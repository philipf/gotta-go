import type { Profile } from '../../config/lookup';

export type ViewModel = {
	slug: string;
	time: string;
	date: string;
};

// Intl formatting in the profile's timezone gives us HH:MM and "Dow DD Mon"
// without pulling in a date library. en-GB chosen for 24-hour HH:MM by default.
const TIME = new Map<string, Intl.DateTimeFormat>();
const DATE = new Map<string, Intl.DateTimeFormat>();

function timeFmt(tz: string): Intl.DateTimeFormat {
	let fmt = TIME.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		TIME.set(tz, fmt);
	}
	return fmt;
}

function dateFmt(tz: string): Intl.DateTimeFormat {
	let fmt = DATE.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			weekday: 'short',
			day: 'numeric',
			month: 'short',
		});
		DATE.set(tz, fmt);
	}
	return fmt;
}

export function buildViewModel(profile: Profile, now: Date): ViewModel {
	const time = timeFmt(profile.timezone).format(now);
	const parts = dateFmt(profile.timezone).formatToParts(now);
	const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
	const dd = parts.find((p) => p.type === 'day')?.value ?? '';
	const mn = parts.find((p) => p.type === 'month')?.value ?? '';
	return {
		slug: profile.slug,
		time,
		date: `${wd} ${dd} ${mn}`,
	};
}
