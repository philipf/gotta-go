# Findings: `poc/kv-cache/` Cloudflare KV spike (GH #24)

**Status:** ✅ done. All four learning goals exercised, both locally (Miniflare) and at the
real edge (`wrangler dev --remote`). Run on **wrangler 4.95.0**, 2026-05-31.

This was a throwaway learning spike, **not** the production cache. The route, code, and
remote namespace exist only to gather the evidence below. See `plan.md` for the design and
the full experiment matrix.

## What was built
- `GET /poc-kv?stop_id=TAKA1&limit=3&ttl=<n>` (`src/index.ts`).
- Key `pred:${stop_id}:${limit}`; value = **raw Metlink response body string** (cache
  before mapping, per #24); metadata `{ storedAt }` so a hit reports `ageMs`.
- Miss → real Metlink `stop-predictions` call (timed) → `put` with `expirationTtl: ttl` →
  return `{ source: "metlink", upstreamMs, ... }`. Hit → `{ source: "kv", ageMs, ... }`.
- Upstream errors are **not** cached (returns `metlink-error`, no `put`).

## How to reproduce
```bash
cd poc/kv-cache
pnpm install
pnpm cf-typegen          # regenerate worker-configuration.d.ts
pnpm dev                 # local Miniflare on :8788
pnpm dev:remote          # real edge (needs the real namespace id in wrangler.jsonc)
curl "http://localhost:8788/poc-kv?stop_id=TAKA1&limit=3&ttl=60"
```

---

## What was proved

### 1. KV API mechanics
`getWithMetadata(key, 'text')` returns `{ value, metadata }` in one round-trip — storing
`storedAt` in metadata is the clean way to compute cache age. `put(key, body, {
expirationTtl, metadata })` works as documented.

### 2. The 60 s `expirationTtl` floor — the headline finding
**The floor is a hard, server-side validation and it is enforced in BOTH local Miniflare
and the real edge** (this contradicts the hand-off's prior guess that Miniflare might not
enforce it):

```
KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.
```

| `ttl` | Local | Remote |
|------|-------|--------|
| 30   | `put` throws KV 400 → handler HTTP **500** | same → **500** |
| 5    | throws (500) | (not retested; same class) |
| 60   | **200 OK** | **200 OK** |

So `expirationTtl` **cannot** express a sub-60 s window. Note: a too-low TTL is a *thrown
error*, not a silent floor — production code must never pass `<60`.

### 3. Hit / miss + latency (Experiment B)
- **Local:** miss `source=metlink` `upstreamMs≈307`, `bytes=14221` → immediate
  `source=kv` `ageMs≈35` (no upstream) → `ageMs` grows with wall-clock.
- **TTL expiry → refetch confirmed:** seed (metlink 448 ms) → kv hit → wait 63 s →
  `source=metlink` again (358 ms). The 60 s TTL genuinely expires the key.
- **Remote:** miss `upstreamMs≈48` (the edge sits much closer to Metlink than the dev
  box) → repeated immediate `kv` hits.

### 4. Local vs remote consistency (Experiment C)
- **Read-after-write at the same PoP was immediately consistent** — after a `put`, the
  writing location serves the value from its own cache, so the next `get` is a hit. We saw
  zero miss-after-write locally or remotely.
- **Cross-PoP / global propagation is the eventual-consistency surface.** Cloudflare docs
  put global convergence at up to ~60 s; this is *not* observable from a single client
  hitting one PoP, so treat it as a documented caveat, not something this spike measured.
- Remote upstream latency (~48 ms) ≪ local (~307–448 ms) because the Worker runs at the
  edge, not on the dev machine.

### 5. Wiring
- **Placeholder KV `id` is tolerated by local `wrangler dev`** — Miniflare keys its
  simulated namespace by binding *name*, not id (binding reported `local` mode). A **real**
  id is required for `--remote`.
- `.dev.vars` secrets are auto-surfaced (`Using secrets defined in .dev.vars`).
- Bonus CLI (`wrangler kv key put/get/list`, `--local` and `--remote`) round-trips the same
  keys; `list` shows `expiration` + `metadata.storedAt` — handy for inspecting TTLs.

---

## Implications for #24

**The 30 s freshness window cannot be satisfied by `expirationTtl`** — KV's hard 60 s floor
means TTL alone can only express ≥60 s. Decouple *freshness* (app concern) from *TTL*
(storage GC concern). Options below — **ADR decision deferred** (per the locked plan); this
is evidence + options only.

- **Option A (recommended): app-side freshness check + TTL=60 backstop.** Store `storedAt`
  in metadata (already done). On read, if `Date.now() - storedAt > 30_000`, treat the entry
  as **stale → refetch + re-put**, even though the KV key still exists. TTL=60 stays purely
  as garbage-collection. This gives a *true* 30 s window on top of the 60 s floor.
- **Option B: accept 60 s freshness.** Use TTL=60 and revisit the original 30 s cache target. *(Resolved: no cache at all — [ADR-0010](../../docs/adr/0010-no-metlink-cache-layer.md).)*
  Simplest, but does not meet 30 s.
- **Option C: stale-while-revalidate.** Serve the stale-but-present value immediately and
  kick a background refresh via `ctx.waitUntil`. Best latency; most moving parts.

**Eventual-consistency caveats for the cache:**
- Read-your-writes holds at the writing PoP, so a single-PoP request path behaves like a
  normal cache. But a refetch at PoP A is **not** instantly visible at PoP B — cross-PoP
  reads can lag up to ~60 s. With a 30 s target this means occasional cross-PoP duplicate
  upstream fetches and brief staleness. Acceptable for best-effort departures, but the
  freshness/refresh logic must tolerate it (don't assume a global single source of truth).
- **Never cache error responses** (this spike returns `metlink-error` without `put`) — #24
  should do the same so a transient upstream blip isn't pinned for 60 s.

**Coalescing remains TODO** (deliberately out of scope here). An in-flight `Promise` map
de-dupes concurrent misses *within one isolate*; it does **not** cross isolates/PoPs, and KV
consistency means cross-PoP thundering-herd protection isn't free. Size the coalescing
design against that limit in #24.

---

## Teardown checklist
- [ ] Delete the remote namespace when findings are accepted:
      `wrangler kv namespace delete --namespace-id 0c058038d4504ee9b2a4d9c8c23d3001`
      (currently holds a few short-TTL `pred:*` keys that self-expire within 60 s anyway).
- [x] `.dev.vars` is git-ignored (`.dev.vars*` in `.gitignore`) and was never committed.
- [x] Nothing in `src/worker/` was touched — everything lives in `poc/kv-cache/`.
- [x] ADR follow-up (revisit the 30 s cache target, or a new KV-cache ADR) is decided — [ADR-0010](../../docs/adr/0010-no-metlink-cache-layer.md): no cache
      **after** reviewing these findings — not by the spike.
