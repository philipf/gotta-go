# GottaGo Worker PoC

Cloudflare Worker that will render the radiator frame end-to-end (JSX → SVG → 1-bit BMP). See [`plan.md`](./plan.md) for the iteration breakdown.

## Prereqs

```sh
mise install        # Node (pinned via mise.toml)
pnpm install
```

## Run locally

```sh
pnpm wrangler dev
# → http://127.0.0.1:8787
```

> **Dev caveat — miniflare always negotiates gzip.** `wrangler dev` injects `Accept-Encoding: gzip` into every incoming request to simulate the CF edge, so the worker always enters the gzip branch locally. To inspect the rendered frame, use `curl --compressed localhost:8787 -o frame.bmp` (curl decompresses). To inspect the raw wire bytes, use `curl -H "Accept-Encoding: gzip" localhost:8787 -o frame.gz`. The "raw BMP" branch (`Accept-Encoding` absent) is unreachable under `wrangler dev` and is only verifiable against the deployed worker.

## Deploy

```sh
pnpm wrangler login   # once, interactive
pnpm wrangler deploy
```

Deployed URL: <https://gotta-go-worker.philip-fourie-4ad.workers.dev>
