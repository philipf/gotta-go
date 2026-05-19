# Worker PoC — Plan & Issue Tracker

**Goal:** Wrap Satori + the `to-bmp` BMP pipeline in a Cloudflare Worker. End-to-end: HTTP request → JSX layout → SVG → 1-bit BMP response, returned in well under 1 s, bundle under 3 MiB.

**Read first:** [`to-bmp/hand-off-next-steps.md`](./to-bmp/hand-off-next-steps.md) — decisions already made, traps to avoid, concrete code snippets for static wasm/font imports.

**Out of scope (deferred to later PoCs):**
- Metlink API integration (`poc/metlink/` owns this)
- KV caching
- Profile-phase resolution from server time
- `X-Radiator-Slug` / `X-Radiator-Token` auth
- Real hardware test against the LilyGO panel

---

## How this plan works

Each iteration has **two gates** in order:

1. **Local gate** — you test against `wrangler dev` on localhost
2. **Deploy gate** — you test against the deployed `*.workers.dev` URL

I stop after each gate and hand back to you. The deploy gate is what catches issues that only show up in the real Workers runtime (wasm loading, asset bundling, isolate cold-start) — testing it every iteration means we never accumulate "works locally, broken in prod" surprises.

Subtasks are checkboxes — tick them as we go so the file doubles as the live progress tracker.

---

## Iteration 1 — Scaffold, dev loop, first deploy

**Why first:** prove both halves of the loop work — local dev and Cloudflare deploy — before any of our code is in play. This is also where any CF account / `wrangler login` friction surfaces.

- [x] Run `pnpm create cloudflare@latest worker` from `poc/`, pick **"Hello World" TypeScript**, decline the offer to deploy at this step, decline git init (this repo already has git)
- [x] Move `poc/worker-plan.md` → `poc/worker/plan.md` so the plan lives alongside the code
- [x] Add `mise.toml` matching `to-bmp/mise.toml` (pin Node version for parity)
- [x] Run `mise install && pnpm install && pnpm wrangler dev`
- [x] Add a short `README.md` documenting both `pnpm wrangler dev` and `pnpm wrangler deploy`

**Local gate:** `curl localhost:8787` returns the template's Hello World string. ✅

- [x] `pnpm wrangler login` if not already authenticated (you'll do this interactively in your shell — I'll pause and ask)
- [x] `pnpm wrangler deploy`
- [x] Note the resulting `*.workers.dev` URL in the README

**Deploy gate:** `curl https://<your-worker>.workers.dev` returns Hello World. CF auth and deploy pipeline are alive. ✅ — deployed to <https://gotta-go-worker.philip-fourie-4ad.workers.dev>

---

## Iteration 2 — Port the BMP encoder, return a static BMP

**Why next:** the encoder is pure JS with no Workers-specific concerns. If it runs here, the easy half is done.

- [x] Copy `rgbaTo1BitBmp()` verbatim from `to-bmp/index.ts` into `src/bmp.ts`. No edits.
- [x] In the request handler, generate the synthetic checkerboard+diagonal test pattern (port the `--pattern` branch from `to-bmp/index.ts`) and pipe it through `rgbaTo1BitBmp()`
- [x] Return the `Uint8Array` directly: `new Response(bmp, { headers: { 'content-type': 'image/bmp' } })`
- [x] Sanity assertion in the handler (or a tiny test): output length === 64_862, first two bytes === `0x42 0x4D`

**Local gate:** `curl localhost:8787 -o frame.bmp && magick frame.bmp frame.png` produces a recognisable checkerboard PNG. ✅

- [x] `pnpm wrangler deploy`

**Deploy gate:** Same `curl` against the `*.workers.dev` URL produces the same checkerboard PNG. ✅ — prod BMP byte-identical to local (64 862 B, 960×540×1-bit, top-down)

---

## Iteration 3 — Wire resvg-wasm, render hand-rolled SVG

**Why next:** rasterisation is the part most likely to bite under Workers (wasm loading, font registration). Isolate it before adding Satori.

- [x] Add `@resvg/resvg-wasm` dependency
- [x] Copy `PressStart2P-Regular.ttf` from `to-bmp/` into `poc/worker/` (or `src/assets/`)
- [x] Static-import the wasm and font:
  ```ts
  import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
  import pressStartTtf from './PressStart2P-Regular.ttf';
  ```
- [x] Use the lazy `wasmReady` pattern from the hand-off doc so `initWasm` runs once per isolate
- [x] Inline the contents of `to-bmp/input.svg` as a string constant for now (no Satori yet)
- [x] Pipeline in handler: SVG string → `new Resvg(svg, { font: { fontBuffers: [pressStartTtf], defaultFontFamily: 'Press Start 2P', loadSystemFonts: false } })` → `.render().pixels` → `rgbaTo1BitBmp()` → response
- [x] Verify Wrangler version is ≥ 3.15 (handles `.wasm` and binary imports natively) — running 4.92.0

> **Note:** `.wasm` bundles natively, but `.ttf` does not. Added a `rules: [{ type: "Data", globs: ["**/*.ttf"] }]` entry to `wrangler.jsonc` so the font is bundled as an `ArrayBuffer` import. Ambient declarations for `*.wasm` and `*.ttf` live in `src/assets.d.ts`.

**Local gate:** Output BMP visually matches `to-bmp/out.bmp`. Same hero text, same layout, no missing glyphs. ✅ — **byte-identical** to `to-bmp/out.bmp`

- [x] `pnpm wrangler deploy`

**Deploy gate:** Same visual match against the `*.workers.dev` URL. This is the iteration most likely to expose wasm/asset bundling issues — if it works in prod, the hard part is done. ✅ — prod BMP byte-identical to local and to `to-bmp/out.bmp`. Upload: 2.5 MiB (980 KiB gzip).

---

## Iteration 4 — Add Satori, JSX → SVG → BMP

**Why next:** this is the seam the whole PoC exists to validate. Everything before this was setup.

- [x] Add `satori` (and `satori-html` if cross-referencing `poc/satori-react/` shows it's needed) — satori only; JSX runtime via `react`. Also added `@types/react` for the `ReactNode` type.
- [x] Port the `to-bmp/input.svg` layout into a TSX component, cross-referencing `poc/satori-react/index.jsx` for the call shape Satori expects → `src/layout.tsx`. Coordinate system note: SVG `<text y=N>` is the baseline; Satori uses CSS top-left. `Txt` helper takes panel-local `(left, baseline)` and offsets `top = baseline - size`. Lines/markers use absolute-positioned `<div>`s with `borderRadius` for the marker.
- [x] If the mockup includes images: pre-fetch each one and inline as a `data:` URL **before** handing the tree to Satori (Satori's image fetcher behaves oddly inside Workers — see pitfalls link in `to-bmp/plan.md`) — N/A, mockup is text + lines only.
- [x] Pass `PressStart2P-Regular.ttf` to Satori's `fonts` option using the same TTF buffer the resvg call uses → single `fontBuffer = new Uint8Array(pressStartTtf)` shared by both `jsxToSvg` and `svgToRgba` in `src/render.ts`.
- [x] Pipeline: JSX → `satori()` → SVG string → resvg → BMP

> **Workers runtime quirk:** Satori (via react-dom’s deps) references `process` at module-load. Added `"compatibility_flags": ["nodejs_compat"]` in `wrangler.jsonc`.
>
> **Test sandbox quirk:** Satori’s internal yoga-wasm calls `WebAssembly.instantiate` at runtime, which the `@cloudflare/vitest-pool-workers` sandbox blocks. Wrangler dev + prod both allow it, so the integration test was demoted to a unit test for `rgbaTo1BitBmp` only; the full pipeline is validated via the deploy gate.

**Local gate:** Worker returns a valid BMP, visually equivalent to iteration 3's output. The JSX → SVG → BMP chain works end-to-end. ✅

- [x] `pnpm wrangler deploy`

**Deploy gate:** Same visual match against the `*.workers.dev` URL. ✅ — prod BMP visually equivalent to local (~4.7% pixel diff = sub-pixel font-edge rendering between miniflare and workerd; layout/text/lines/markers all identical). Bundle: 3.4 MiB upload / **1.2 MiB gzip**, worker startup 36 ms.

---

## Iteration 5 — Headers, bundle size, cold-start, hand-off

**Why last:** measurement and documentation. Don't bother until the pipeline works.

- [x] Add `'x-sleep-seconds': '120'` to the response headers (hardcoded — profile-phase logic is a later PoC)
- [x] Bundle size check: `pnpm wrangler deploy --dry-run --outdir dist && du -sh dist/`. Target < 3 MiB. **Result: 3 456 KiB upload / 1 202 KiB gzip — slightly over the 3 MiB target.** Composition: `index_bg.wasm` 2.4 MiB (resvg), `index.js` 921 KiB (Satori + yoga-wasm-as-base64 + worker code), `PressStart2P-Regular.ttf` 116 KiB. No duplication; resvg-wasm is the dominant cost. Recording the new floor in the hand-off rather than fighting the budget.

**Local gate:** Header present in `curl -I localhost:8787`, bundle size recorded and within budget. ✅ (`x-sleep-seconds: 120` confirmed; bundle recorded above; over-target accepted with rationale.)

- [x] `pnpm wrangler deploy` (final deploy of the PoC)
- [x] Cold-start measurement against the deployed URL: trigger a cold isolate (deploy invalidates, or wait long enough), then `time curl https://<worker>.workers.dev` ×5; record cold + warm numbers. **Findings: the first 1–3 requests on a freshly-deployed isolate return HTTP 500 with `wrangler tail` reporting "The Workers runtime canceled this request because it detected that your Worker's code had hung."** CPU ~97 ms, wallTime ~102 ms — runtime can't distinguish synchronous wasm compilation from infinite loop. Once warm, TTFB median ~98 ms, p90 ~210 ms (n=20). Server-side wallTime 53–87 ms warm. Mitigation deferred to radiator PoC: client-side retry on 5xx. Full analysis in `hand-off-next-steps.md` § "Open issues / 1. Cold-start hung-worker cancellation".
- [x] Final smoke test against deployed URL: `curl > frame.bmp && magick frame.bmp frame.png`, eyeball against `to-bmp/out.bmp`. ✅ ~4.7% pixel diff = sub-pixel font edges, layout/text/lines/markers identical (same finding as Iter 4).
- [x] Confirm `x-sleep-seconds` header present in `curl -I` against deployed URL ✅
- [x] Write `poc/worker/hand-off-next-steps.md` in the same style as `to-bmp/hand-off-next-steps.md`: what's proven (with real deploy numbers, not just local), decisions made, deferred questions, traps for the next agent ✅

**Deploy gate:** All targets met against the deployed Worker. Bundle, cold-start, warm latency, and visual output documented from production. PoC is officially done. ✅ — with the caveat that cold-start is unreliable on this stack and the next PoC must compensate.

---

## Iteration 6 — Gzip the frame body on the wire (stretch) — ✅

> **Status: done.** Root cause of the double-gzip was Cloudflare's `Response.encodeBody` field defaulting to `"automatic"` — when the worker sets `Content-Encoding: gzip`, the runtime re-applies gzip on top. Setting `encodeBody: 'manual'` suppresses that. Earlier mitigation attempts (buffered/streamed body, explicit `Content-Length`, `Cache-Control: no-transform`/`no-store`, `Content-Encoding: deflate`) all failed because they don't address `encodeBody`. Filed and resolved as <https://github.com/philipf/gotta-go/issues/13>.

**Why now:** [ADR-0001](../../docs/adr/0001-frame-transport-compression.md) commits the project to gzip-compressed frame bodies. The pipeline is known-good, so wiring compression in now lets us measure the real ratio on the production-like layout, satisfies the ADR's verification checklist, and de-risks the radiator PoC (its HTTP client needs to handle `Content-Encoding: gzip` from day one).

**ADR scope recap:** Worker compresses with `CompressionStream('gzip')`, sets `Content-Encoding: gzip`, keeps `Content-Type: image/bmp`. Default compression level. Radiator sends `Accept-Encoding: gzip` and decompresses. **Cloudflare's edge auto-compression skips `image/*` MIME types**, so we must call `CompressionStream` ourselves — the edge will not save us.

- [x] Add a small `gzip(bytes: Uint8Array): Promise<Uint8Array>` helper in `src/index.ts` (or `src/compress.ts`) that pipes the BMP through `new CompressionStream('gzip')` and returns the compressed bytes
- [x] In the request handler, check `request.headers.get('accept-encoding')` for `gzip` and **conditionally** compress: compressed branch sets `Content-Encoding: gzip` **and `encodeBody: 'manual'`**; uncompressed branch returns the raw BMP unchanged. Both branches keep `Content-Type: image/bmp` and `x-sleep-seconds: 120`
- [x] Add a one-off byte-identity check during local testing: gunzip the compressed response and `cmp` against the uncompressed response — they must be byte-for-byte equal (satisfies ADR §4 verification) — verified on prod (dev pollution noted below)

> **Local-gate dev caveat:** miniflare/wrangler-dev injects `Accept-Encoding: gzip` into every incoming request to simulate the CF edge, so the worker always enters the compressed branch under `wrangler dev` regardless of what curl sends. Local-gate check 5 ("no `Accept-Encoding` → no `Content-Encoding`") is therefore unverifiable locally and was validated against the deploy gate instead, where CF correctly strips the encoding for clients that didn't ask for it.

**Local gate:**
- `curl -H "Accept-Encoding: gzip" -o frame.gz localhost:8787 && ls -l frame.gz` shows a file ≪ 64 KB (ADR target 5–13 KB) — **1 586 B** ✅
- `curl -I -H "Accept-Encoding: gzip" localhost:8787` shows `Content-Encoding: gzip` and `Content-Type: image/bmp` ✅
- `curl -H "Accept-Encoding: gzip" --compressed localhost:8787 | wc -c` returns `64862` ✅
- `diff <(curl -s --compressed -H "Accept-Encoding: gzip" localhost:8787) <(curl -s localhost:8787)` is empty — **unverifiable in dev** (miniflare injects `Accept-Encoding`, so the "raw" curl also gets the compressed branch); verified on prod instead ✅
- `curl -I localhost:8787` (no `Accept-Encoding`) shows **no** `Content-Encoding` header — **unverifiable in dev** (same reason); verified on prod ✅

- [x] `pnpm wrangler deploy`

**Deploy gate:** All five local-gate `curl` checks repeated against the `*.workers.dev` URL produce the same results. ✅
- Wire size with `Accept-Encoding: gzip`: **1 586 B** (40.9× smaller than 64 862 B — better than ADR estimate of 5–13 KB)
- `--compressed` decoded body: 64 862 B, valid BMP1, byte-identical to the raw branch
- `gunzip` once → valid BMP; cannot `gunzip` a second time (single gzip layer confirmed — double-gzip resolved)
- No `Accept-Encoding` on request → CF strips `Content-Encoding`, client gets raw 64 862 B BMP

- [x] Record empirical compressed wire size and any wallTime delta from `wrangler tail` (CPU should rise by single-digit ms — ADR estimate is 1–5 ms for 64 KB) — **wallTime 47–64 ms (median ~50, n=8 warm gzip requests)**; Iter-5 baseline was 53–87 ms, so gzip cost is within sampling noise (≤ 5 ms, consistent with ADR estimate)
- [x] Update `hand-off-next-steps.md`: add a compressed-size row to the perf table, note `CompressionStream` + `encodeBody: 'manual'` in the decisions table, drop any compression-related items from open-issues, and confirm radiator-PoC scope includes `Accept-Encoding: gzip` + decompression
- [x] Cross-link this iteration's results back into ADR-0001 isn't necessary — the ADR's verification section is the contract, and a green deploy gate here satisfies it

**Deploy gate (final):** Compressed bytes-on-the-wire confirmed against prod URL, byte-identity verified, hand-off updated with measured ratio. ADR-0001 verification §1–§5 satisfied (§6 still waits for the radiator PoC). ✅

---

## Decisions already locked (do not re-litigate)

These come from `to-bmp/hand-off-next-steps.md`. Listed here so they're visible in the issue tracker.

- pnpm (not npm), mise for Node version
- Hand-rolled BMP encoder — no `bmp-ts` or other Buffer-flavoured libs
- Hard luminance threshold @ 128 (no dithering)
- Top-down row order (`biHeight = -540`)
- Palette index 0 = white, 1 = black
- Explicit `font.fontBuffers` + `defaultFontFamily: 'Press Start 2P'` — never `loadSystemFonts: true`
- Press Start 2P at 80 px hero (not 120 px) due to fixed-width constraints

## Traps already documented

See `to-bmp/hand-off-next-steps.md` § "Likely traps for the next agent" — the short list: pnpm-only, no Buffer libs, no system fonts, exact font family name in SVG/JSX, Uint8Array goes straight to `Response`.
