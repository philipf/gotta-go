# Worker

Cloudflare Worker source for GottaGo. Architecture: [ADR-0005](../../docs/adr/0005-worker-source-architecture.md).

## Prerequisites

- [mise](https://mise.jdx.dev/) installs the pinned `node` and `pnpm` versions from [`mise.toml`](./mise.toml):
  ```bash
  mise install
  ```

## Install

All commands run from `src/worker/` (this folder owns its own toolchain — see ADR-0005).

```bash
cd src/worker
pnpm install
```

## Run tests

Vitest runs against the Cloudflare workers-pool sandbox configured in [`vitest.config.ts`](./vitest.config.ts).

```bash
pnpm test           # watch mode
pnpm test --run     # single run, exits 0/1
```

Test discovery is scoped to `**/*.test.ts` and `**/*.test.tsx` colocated with the code they exercise. Per ADR-0005, drive a module through its public `index.ts` rather than reaching into internal files.

### What runs where

| Layer | Runner | Covers |
|---|---|---|
| Unit / behaviour | `pnpm test` (vitest workers-pool) | Pure-JS logic: domain helpers, view-models, BMP encoder, response shapers, gateway mappers. |
| Integration | `pnpm dev` (wrangler) + curl | Full HTTP pipeline including Satori → resvg → BMP → gzip. The workers-pool sandbox blocks `WebAssembly.instantiate` for yoga-wasm, so rendering is exercised only against a live Worker. |

## Run locally

```bash
echo "RADIATOR_SHARED_TOKEN=test-token-123" > .dev.vars
pnpm dev
# Worker listens on http://localhost:8787
```

### Caveat: gzip negotiation under `wrangler dev`

`wrangler dev` / miniflare normalises every inbound request's
`Accept-Encoding` to `"br, gzip"` to emulate the Cloudflare edge — even
when the curl client sends `Accept-Encoding: identity` or omits the
header entirely. This means the `gzip: false` branch of `api/response.frameOk`
is unreachable through `wrangler dev`; the shaper's no-`Content-Encoding`
behaviour is pinned at the unit-test layer instead. End-to-end verification
of an uncompressed BMP response is a production-only check.
