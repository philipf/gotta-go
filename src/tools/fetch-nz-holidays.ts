const NAGER_BASE = "https://date.nager.at/api/v3/PublicHolidays";
const CF_BASE = "https://api.cloudflare.com/client/v4";
const KV_KEY = "public-holidays:NZ:current";

type NagerHoliday = {
	date: string;
	name: string;
	global: boolean;
	counties: string[] | null;
};

type Holiday = {
	date: string;
	name: string;
};

function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) {
		console.error(`Error: missing required environment variable ${name}`);
		process.exit(1);
	}
	return v;
}

async function fetchHolidays(year: number): Promise<NagerHoliday[]> {
	const res = await fetch(`${NAGER_BASE}/${year}/NZ`);
	if (!res.ok) throw new Error(`Nager.Date API ${year}: HTTP ${res.status}`);
	return res.json() as Promise<NagerHoliday[]>;
}

function isRelevant(h: NagerHoliday): boolean {
	return h.global || (h.counties?.includes("NZ-WGN") ?? false);
}

async function writeToKV(
	accountId: string,
	namespaceId: string,
	token: string,
	value: string,
): Promise<void> {
	const url = `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(KV_KEY)}`;
	const res = await fetch(url, {
		method: "PUT",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: value,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`KV write failed: HTTP ${res.status} — ${text}`);
	}
}

async function main() {
	const token = requireEnv("CLOUDFLARE_API_TOKEN");
	const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
	const namespaceId = requireEnv("KV_NAMESPACE_ID");

	const currentYear = new Date().getFullYear();
	const nextYear = currentYear + 1;

	const [current, next] = await Promise.all([
		fetchHolidays(currentYear),
		fetchHolidays(nextYear),
	]);

	const holidays: Holiday[] = [...current, ...next]
		.filter(isRelevant)
		.map(({ date, name }) => ({ date, name }))
		.sort((a, b) => a.date.localeCompare(b.date));

	const json = JSON.stringify(holidays, null, 2);
	await writeToKV(accountId, namespaceId, token, json);
	console.log(json);
}

main().catch((err: Error) => {
	console.error("Error:", err.message);
	process.exit(1);
});
