// Throwaway learning spike for GH #24 — Cloudflare KV cache layer.
// One route: GET /poc-kv?stop_id=TAKA1&limit=3&ttl=<n>
//
// On a KV miss we call Metlink, store the RAW response body string in KV keyed by
// stop_id (+limit), and return it. On a hit we serve straight from KV. The ?ttl knob
// makes the 60 s expirationTtl-floor experiment one curl away.
//
// Quick & dirty by design (hand-off "DI: quick & dirty"): the handler reads
// env.POC_KV and env.METLINK_API_KEY directly — no ADR-0005 edge-DI ceremony.

const METLINK_BASE = 'https://api.opendata.metlink.org.nz/v1';

interface StoredMeta {
	storedAt: number;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== '/poc-kv') {
			return new Response('try GET /poc-kv?stop_id=TAKA1&limit=3&ttl=60\n', { status: 404 });
		}

		const stopId = url.searchParams.get('stop_id') ?? 'TAKA1';
		const limit = url.searchParams.get('limit') ?? '3';
		const ttl = Number(url.searchParams.get('ttl') ?? '60');
		const key = `pred:${stopId}:${limit}`;

		// --- KV read (with metadata so we can compute ageMs) ---
		const { value, metadata } = await env.POC_KV.getWithMetadata<StoredMeta>(key, 'text');
		if (value !== null) {
			const ageMs = metadata?.storedAt ? Date.now() - metadata.storedAt : null;
			return json({
				source: 'kv',
				key,
				ageMs,
				bytes: byteLength(value),
				value: safeParse(value),
			});
		}

		// --- KV miss → real Metlink call ---
		const metlinkUrl = `${METLINK_BASE}/stop-predictions?stop_id=${encodeURIComponent(stopId)}`;
		const startedAt = Date.now();
		const res = await fetch(metlinkUrl, {
			headers: { 'x-api-key': env.METLINK_API_KEY, accept: 'application/json' },
		});
		const body = await res.text();
		const upstreamMs = Date.now() - startedAt;

		if (!res.ok) {
			// Surface the upstream failure; do NOT cache error bodies.
			return json(
				{ source: 'metlink-error', key, upstreamMs, status: res.status, bytes: byteLength(body), value: safeParse(body) },
				502,
			);
		}

		// Note: stop-predictions has no native limit param; #24 filters/limits AFTER the
		// cache. We still key by limit so the cache shape matches #24's intent.
		await env.POC_KV.put(key, body, {
			expirationTtl: ttl,
			metadata: { storedAt: Date.now() } satisfies StoredMeta,
		});

		return json({
			source: 'metlink',
			key,
			ttl,
			upstreamMs,
			bytes: byteLength(body),
			value: safeParse(body),
		});
	},
} satisfies ExportedHandler<Env>;

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload, null, 2), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

// The stored value is a raw string; try to parse for readable output but fall back to raw.
function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}
