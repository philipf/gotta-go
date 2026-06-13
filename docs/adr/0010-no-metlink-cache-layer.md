# ADR-0010: No caching layer for the Metlink gateway

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related:** [Metlink reference](../reference/metlink-stop-predictions.md) (rate limits + call volume), [ADR-0003](0003-radiator-worker-contract.md) (the stale-served error model this retired), [ADR-0005](0005-worker-source-architecture.md) (gateway `cache.ts` slot, "Caching: None" default), [#24](https://github.com/philipf/gotta-go/issues/24) (closed by this ADR), [#51](https://github.com/philipf/gotta-go/issues/51), [#56](https://github.com/philipf/gotta-go/issues/56). Evidence: the throwaway spike in `poc/kv-cache/`.

## Context

[#24](https://github.com/philipf/gotta-go/issues/24) proposed a read-through **KV cache** between the Worker orchestrator and the Metlink client — 30 s TTL plus in-flight coalescing — wrapped as `gateways/metlink/cache.ts` per [ADR-0005](0005-worker-source-architecture.md). Before building it, we ran a throwaway spike (`poc/kv-cache/`) to kick the tires on Cloudflare KV against the real Metlink API, locally and at the edge. The spike's findings, combined with re-reading the actual justification in the [Metlink reference](../reference/metlink-stop-predictions.md) and #24, changed the decision.

**The cache was never load-bearing.** Per #24 and the Metlink reference:

- **Rate limits are a non-issue.** Metlink allows 10 req/s sustained, 20 burst. The stated household worst case is "5 radiators × 2 transit targets = **10 calls** per pathological simultaneous wake" — ~50× headroom. #24 says outright the TTL was "**not chosen for rate-limit reasons**."
- **The only stated benefit was latency amortisation** — sharing one ~500 ms Metlink call across radiators watching the same stop within the TTL window.
- **The workload is background polling.** Radiators wake every 2–5 min (`refresh_interval_minutes`), render a 1-bit frame, and deep-sleep. Nobody waits on a screen; 200 ms vs 700 ms is imperceptible on an e-ink refresh. A cache only ever *hits* when ≥2 radiators request the **same** stop within the TTL — essentially only the synchronised morning wake.

**The spike showed KV is, additionally, a poor fit for the 30 s target** (full results in `poc/kv-cache/`):

- **Hard 60 s `expirationTtl` floor**, enforced in *both* local Miniflare and the real edge: `KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.` A 30 s freshness window can't be expressed by TTL — it would require app-side freshness logic layered on top.
- **Single household = single Cloudflare PoP.** KV's distinguishing advantages — global replication and cross-deploy persistence — buy nothing here, while its eventual-consistency model adds caveats.
- **KV does not provide coalescing** anyway — the genuinely valuable part. #24 scoped coalescing to "within a single Worker invocation," which only de-dupes one request rendering the same stop twice; true cross-request herd protection (the synchronised wake) needs a Durable Object, not KV.

A Cache-API (`caches.default`) variant was considered as a better-fitting primitive (no 60 s floor, colocated, no resource to provision) but rejected on the same root grounds: at household scale there is no problem worth a cache's complexity, and `caches.default` carries its own caveats (no-op on `*.workers.dev`, must rewrite Metlink's `no-store` header before `put`).

## Decision

**Do not implement any caching layer for the Metlink gateway** — no KV, no Cache API, no in-isolate/module-level memoisation. The Worker calls the Metlink Stop Predictions endpoint (`GET /stop-predictions`) directly on each `priority_split` frame request and renders the response, relying on Metlink's documented rate-limit headroom at household scale.

This makes [ADR-0005](0005-worker-source-architecture.md)'s default — "Caching: None" until an upstream call is demonstrably hot — the standing state for the Metlink gateway. The gateway is just **client + mapper**; the `cache.ts` slot stays empty.

## Consequences

### Positive

- No KV namespace, binding, or `wrangler` config to provision or operate.
- No 60 s-floor workaround, no app-side freshness layer, no eventual-consistency reasoning, no cache-invalidation logic, no coalescing machinery.
- The gateway stays a thin, easily-tested client+mapper; one fewer module and test surface.

### Negative / follow-ups

- **Loss of the stale-served resilience fallback.** [ADR-0003](0003-radiator-worker-contract.md) ("Metlink staleness preferred over 502") and the PRD §8 error model served *stale, past-TTL* cache data as `200 X-Cache-Status: stale-served` on a Metlink outage instead of `502`. **With no cache there is nothing stale to fall back on**, so a Metlink outage must produce an explicit error/idle frame instead. This resilience question moves to **[#56](https://github.com/philipf/gotta-go/issues/56)** (Metlink failure policy). The `X-Cache-Status` (`hit`/`miss`/`stale-served`) and `X-Metlink-Fetched-At` informational headers and the `stale-served` contract behaviour are now **vestigial**; retiring or repurposing them is a wire-contract change (ADR-0003 / OpenAPI) and is intentionally **not** done in this ADR — fold it into #56.
- **Every `priority_split` frame pays the full ~500 ms Metlink latency.** Acceptable: it is a background refresh on a multi-minute interval, not an interactive request.

### Retained evidence

The `poc/kv-cache/` spike is kept in-repo on purpose (the locked "lives in `poc/` by design" decision): it holds the empirical 60 s-floor proof, the hit/miss + latency numbers, and the options analysis, so a future revisit starts from evidence rather than re-running the spike.

## Revisit triggers

This decision is scoped to **single-household, self-hosted GottaGo on one PoP**. Reopen the caching question if any of these change:

- GottaGo becomes **multi-tenant / hosted** (many households across regions) — global sharing, cross-deploy persistence, and aggregated rate-limit pressure all start to matter.
- **Metlink tightens its rate limits** to where household worst-case wake bursts approach the budget.
- A future **interactive (non-background) surface** appears where ~500 ms upstream latency becomes user-perceptible.

## References

- `poc/kv-cache/` — the spike: `hand-off-next-steps.md` (findings, 60 s-floor proof, options), `plan.md` (experiment matrix).
- [Metlink reference](../reference/metlink-stop-predictions.md) §"Rate limits and call volume", [ADR-0003](0003-radiator-worker-contract.md) §"Error model" (the stale-served rule this retired, since rewritten), [ADR-0005](0005-worker-source-architecture.md) §Gateways / "Caching: None" default.
- [#24](https://github.com/philipf/gotta-go/issues/24) (closed by this ADR), [#51](https://github.com/philipf/gotta-go/issues/51) (second-deploy scope), [#56](https://github.com/philipf/gotta-go/issues/56) (failure policy — inherits the stale-served gap).
