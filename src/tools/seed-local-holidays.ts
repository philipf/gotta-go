import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRelevantHolidays, KV_KEY } from "./nz-holidays.ts";

// Seeds the LOCAL wrangler/miniflare KV store — the one `wrangler dev` reads —
// with the same data the remote seed (fetch-nz-holidays.ts) writes, so the
// dual_month_calendar feature shades public holidays in local development.
// No Cloudflare credentials needed: it writes through `wrangler kv --local`.
//
// Run from src/tools (as the mise task does); the worker lives one dir over.
// Invoke wrangler's binary directly rather than via `pnpm wrangler`, so pnpm's
// pre-run dependency check doesn't get in the way.
const WORKER_DIR = join(process.cwd(), "..", "worker");
const WRANGLER_BIN = join(WORKER_DIR, "node_modules", ".bin", "wrangler");

async function main() {
	const currentYear = new Date().getFullYear();
	const holidays = await fetchRelevantHolidays(currentYear);
	const json = JSON.stringify(holidays, null, 2);

	const dir = mkdtempSync(join(tmpdir(), "gotta-go-holidays-"));
	const file = join(dir, "holidays.json");
	writeFileSync(file, json);
	try {
		execFileSync(
			WRANGLER_BIN,
			["kv", "key", "put", KV_KEY, "--path", file, "--binding", "PUBLIC_HOLIDAYS", "--local"],
			{ cwd: WORKER_DIR, stdio: "inherit" },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	console.log(`\nSeeded ${holidays.length} holidays to local KV under "${KV_KEY}".`);
}

main().catch((err: Error) => {
	console.error("Error:", err.message);
	process.exit(1);
});
