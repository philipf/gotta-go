# Plan: `poc/kv-cache/` — Cloudflare KV spike (GH #24)

## Goal
Kick the tires on Cloudflare KV before building the production read-through cache for the
Metlink gateway (GH #24). Prove KV mechanics with a real Metlink stop-prediction call:
HTTP → store body in KV → retrieve → observe latency saved + TTL behaviour, both locally
(Miniflare) and at the real edge (`--remote`).

**This is a throwaway learning spike, not the production cache.** Optimise for fast
tire-kicking and clearly captured findings.

## Scope
- IN: KV `get`/`put`/`expirationTtl`, binding + local-dev wiring, local-vs-remote
  consistency, end-to-end with real Metlink.
- OUT: in-flight coalescing (note as #24 TODO), response mapping, ADR-0005 edge-DI,
  the 30 s-vs-60 s TTL decision (leave open for #24 with evidence).

## Design
- One route: `GET /poc-kv?stop_id=TAKA1&limit=3&ttl=<n>`.
- Key: `pred:${stop_id}:${limit}`.
- Value: raw Metlink response body string (cache BEFORE mapping, per #24).
- Metadata: `{ storedAt }` so a KV hit can report `ageMs`.
- Hit → `{ source: "kv", key, ageMs, bytes, value }`.
- Miss → real Metlink fetch (timed), `put` with `expirationTtl: ttl`, then
  `{ source: "metlink", key, ttl, upstreamMs, bytes, value }`.
- Quick & dirty DI: handler reads `env.POC_KV` / `env.METLINK_API_KEY` directly.

## Tooling
- **mise** for tooling (`mise.toml` → `node = "latest"`), **pnpm** not npm.
- `pnpm dev` = `wrangler dev`; `pnpm dev:remote` = `wrangler dev --remote`;
  `pnpm cf-typegen` = `wrangler types`.

## Test target
- `GET /stop-predictions?stop_id=TAKA1` against `https://api.opendata.metlink.org.nz/v1`,
  auth header `x-api-key: <METLINK_API_KEY>` (value copied from `src/worker/.dev.vars`).

## Experiment matrix (results — wrangler 4.95.0, 2026-05-31)

| # | Experiment | Local (Miniflare) | Remote (`--remote`) |
|---|---|---|---|
| A | TTL floor — `?ttl=30`/`60` | **Floor ENFORCED.** `ttl=30`→`KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.` (our handler→HTTP 500). `ttl=60`→200. | **Same.** `ttl=30`→500 (KV 400), `ttl=60`→200. Genuine 60 s floor. |
| B | hit/miss + latency | miss `metlink` upstreamMs **307**, bytes 14221 → immediate `kv` hit ageMs ~35 (no upstream) → ageMs grows. Expiry: seed (448 ms) → `kv` → after 63 s → `metlink` (358 ms). **Expiry→refetch confirmed.** | miss `metlink` upstreamMs **48** (edge sits near Metlink) → 5 immediate reads all `kv`, ageMs 700→871. |
| C | local vs remote / consistency | n/a | **Read-after-write at the same PoP was immediately consistent** (writing PoP caches the value). Cross-PoP global propagation can lag up to ~60 s per CF docs — not testable from one machine; noted as caveat. Remote upstream (48 ms) ≪ local (307–448 ms). |
| D | bonus raw CLI | `wrangler kv key put/get/list --binding POC_KV --local` works; `list` shows `pred:*` keys with `expiration` + `metadata.storedAt`. | `wrangler kv key list --namespace-id <id> --remote` shows persisted keys with expiration + metadata. |

## Wiring learnings
- **Placeholder KV `id` IS tolerated locally** — Miniflare keys its simulated namespace by binding name, not id (binding showed `local` mode). A real id is required for `--remote`; created via `wrangler kv namespace create POC_KV` → `0c058038d4504ee9b2a4d9c8c23d3001`.
- `.dev.vars` secrets are surfaced automatically (`Using secrets defined in .dev.vars`).
- `nodejs_compat` makes `wrangler types` suggest `@types/node`, but `tsc --noEmit` passes without it (we use no Node APIs).

## Open questions for #24
- How to satisfy a 30 s freshness window given KV's 60 s `expirationTtl` floor.
- Eventual-consistency caveats for a read-through cache.
- Coalescing remains TODO.
