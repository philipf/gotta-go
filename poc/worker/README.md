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

## Deploy

```sh
pnpm wrangler login   # once, interactive
pnpm wrangler deploy
```

Deployed URL: <https://gotta-go-worker.philip-fourie-4ad.workers.dev>
