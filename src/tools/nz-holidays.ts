// Shared NZ public-holiday fetch + filter, used by both the remote KV seed
// (fetch-nz-holidays.ts) and the local dev KV seed (seed-local-holidays.ts)
// so the data source, filter rule, and value shape stay single-sourced.

const NAGER_BASE = "https://date.nager.at/api/v3/PublicHolidays";

export const KV_KEY = "public-holidays:NZ:current";

type NagerHoliday = {
	date: string;
	name: string;
	global: boolean;
	counties: string[] | null;
};

export type Holiday = {
	date: string;
	name: string;
};

async function fetchYear(year: number): Promise<NagerHoliday[]> {
	const res = await fetch(`${NAGER_BASE}/${year}/NZ`);
	if (!res.ok) throw new Error(`Nager.Date API ${year}: HTTP ${res.status}`);
	return res.json() as Promise<NagerHoliday[]>;
}

function isRelevant(h: NagerHoliday): boolean {
	return h.global || (h.counties?.includes("NZ-WGN") ?? false);
}

// National + Wellington-region holidays for the given year and the next,
// merged and sorted by date — the value shape the worker reads from KV.
export async function fetchRelevantHolidays(currentYear: number): Promise<Holiday[]> {
	const nextYear = currentYear + 1;
	const [current, next] = await Promise.all([
		fetchYear(currentYear),
		fetchYear(nextYear),
	]);
	return [...current, ...next]
		.filter(isRelevant)
		.map(({ date, name }) => ({ date, name }))
		.sort((a, b) => a.date.localeCompare(b.date));
}
