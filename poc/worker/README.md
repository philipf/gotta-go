# GottaGo Worker PoC

Cloudflare Worker that will render the radiator frame end-to-end (JSX → SVG → 1-bit BMP). See [`plan.md`](./plan.md) for the iteration breakdown.

> The production worker now lives at [`src/worker/`](../../src/worker/). For a sequence diagram + component map of the live `GET /v1/frame` flow, see [`docs/worker-frame-request.md`](../../docs/worker-frame-request.md).

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

## Manual testing

The worker exposes `GET /v1/frame` and returns a 1-bit BMP (960×540). Required headers:

| Header             | Example                  | Notes                                |
| ------------------ | ------------------------ | ------------------------------------ |
| `X-Radiator-Token` | `test-token-123`         | Local default; use prod token live   |
| `X-Radiator-Slug`  | `bedroom-philip-tania`   |                                      |
| `Accept`           | `image/bmp`              |                                      |

Substitute the base URL as needed:

- Local: `http://localhost:8787`
- Deployed: `https://gotta-go-worker.philip-fourie-4ad.workers.dev`

### Bruno

A ready-to-run collection lives at [`tests/bruno/Worker/`](../../tests/bruno/Worker):

1. Open the `tests/bruno/Worker` folder in Bruno.
2. Select the **Local** or **Cloudflare** environment.
3. Set `Radiator-Token` for that environment (`test-token-123` locally; prod token against Cloudflare — it's stored as a secret).
4. Run **Get Frame**. Bruno renders the BMP body inline.

### curl

```sh
curl -sS --compressed \
  -H 'X-Radiator-Token: test-token-123' \
  -H 'X-Radiator-Slug: bedroom-philip-tania' \
  -H 'Accept: image/bmp' \
  -o frame.bmp \
  'http://localhost:8787/v1/frame'
file frame.bmp   # → PC bitmap, Windows 3.x format, 960 x -540 x 1
```

`--compressed` makes curl negotiate gzip and decompress for you, so `frame.bmp` is always the raw BMP regardless of which branch the worker took.

#### Bonus: verify gzip is on the wire

Drop `--compressed`, add `Accept-Encoding: gzip`, and dump the response headers:

```sh
curl -sS -D - \
  -H 'X-Radiator-Token: test-token-123' \
  -H 'X-Radiator-Slug: bedroom-philip-tania' \
  -H 'Accept: image/bmp' \
  -H 'Accept-Encoding: gzip' \
  -o frame.gz \
  'https://gotta-go-worker.philip-fourie-4ad.workers.dev/v1/frame'
```

Expect `content-encoding: gzip` and `content-length` ≈ 500. Sanity-check:

```sh
file frame.gz                          # → gzip compressed data, original size … 64862
gunzip -c frame.gz | file -            # → PC bitmap, Windows 3.x format
```

### httpie

Local (plain HTTP — use `http`):

```sh
http --ignore-stdin --download --output frame.bmp \
  GET 'localhost:8787/v1/frame' \
  X-Radiator-Token:test-token-123 \
  X-Radiator-Slug:bedroom-philip-tania \
  Accept:image/bmp
file frame.bmp
```

Deployed (HTTPS — use `https`):

```sh
https --ignore-stdin --download --output frame.bmp \
  GET 'gotta-go-worker.philip-fourie-4ad.workers.dev/v1/frame' \
  X-Radiator-Token:<prod-token> \
  X-Radiator-Slug:bedroom-philip-tania \
  Accept:image/bmp
```

> Bruno and httpie both transparently decompress gzip responses and hide the `Content-Encoding` header, so they're great for functional checks but **can't be used to verify gzip is on the wire** — use the curl bonus step above for that.
