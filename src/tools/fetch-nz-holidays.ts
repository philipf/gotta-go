import { fetchRelevantHolidays, KV_KEY } from "./nz-holidays.ts";

const CF_BASE = "https://api.cloudflare.com/client/v4";

function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) {
		console.error(`Error: missing required environment variable ${name}`);
		process.exit(1);
	}
	return v;
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
	const holidays = await fetchRelevantHolidays(currentYear);

	const json = JSON.stringify(holidays, null, 2);
	await writeToKV(accountId, namespaceId, token, json);
	console.log(json);
}

main().catch((err: Error) => {
	console.error("Error:", err.message);
	process.exit(1);
});
