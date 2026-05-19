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

- [ ] Add `@resvg/resvg-wasm` dependency
- [ ] Copy `PressStart2P-Regular.ttf` from `to-bmp/` into `poc/worker/` (or `src/assets/`)
- [ ] Static-import the wasm and font:
  ```ts
  import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
  import pressStartTtf from './PressStart2P-Regular.ttf';
  ```
- [ ] Use the lazy `wasmReady` pattern from the hand-off doc so `initWasm` runs once per isolate
- [ ] Inline the contents of `to-bmp/input.svg` as a string constant for now (no Satori yet)
- [ ] Pipeline in handler: SVG string → `new Resvg(svg, { font: { fontBuffers: [pressStartTtf], defaultFontFamily: 'Press Start 2P', loadSystemFonts: false } })` → `.render().pixels` → `rgbaTo1BitBmp()` → response
- [ ] Verify Wrangler version is ≥ 3.15 (handles `.wasm` and binary imports natively)

**Local gate:** Output BMP visually matches `to-bmp/out.bmp`. Same hero text, same layout, no missing glyphs.

- [ ] `pnpm wrangler deploy`

**Deploy gate:** Same visual match against the `*.workers.dev` URL. This is the iteration most likely to expose wasm/asset bundling issues — if it works in prod, the hard part is done.

---

## Iteration 4 — Add Satori, JSX → SVG → BMP

**Why next:** this is the seam the whole PoC exists to validate. Everything before this was setup.

- [ ] Add `satori` (and `satori-html` if cross-referencing `poc/satori-react/` shows it's needed)
- [ ] Port the `to-bmp/input.svg` layout into a TSX component, cross-referencing `poc/satori-react/index.jsx` for the call shape Satori expects
- [ ] If the mockup includes images: pre-fetch each one and inline as a `data:` URL **before** handing the tree to Satori (Satori's image fetcher behaves oddly inside Workers — see pitfalls link in `to-bmp/plan.md`)
- [ ] Pass `PressStart2P-Regular.ttf` to Satori's `fonts` option using the same TTF buffer the resvg call uses
- [ ] Pipeline: JSX → `satori()` → SVG string → resvg → BMP

**Local gate:** Worker returns a valid BMP, visually equivalent to iteration 3's output. The JSX → SVG → BMP chain works end-to-end.

- [ ] `pnpm wrangler deploy`

**Deploy gate:** Same visual match against the `*.workers.dev` URL.

---

## Iteration 5 — Headers, bundle size, cold-start, hand-off

**Why last:** measurement and documentation. Don't bother until the pipeline works.

- [ ] Add `'x-sleep-seconds': '120'` to the response headers (hardcoded — profile-phase logic is a later PoC)
- [ ] Bundle size check: `pnpm wrangler deploy --dry-run --outdir dist && du -sh dist/`. Target < 3 MiB. If it blows out, prime suspect is duplicated wasm or fonts bundled twice.

**Local gate:** Header present in `curl -I localhost:8787`, bundle size recorded and within budget.

- [ ] `pnpm wrangler deploy` (final deploy of the PoC)
- [ ] Cold-start measurement against the deployed URL: trigger a cold isolate (deploy invalidates, or wait long enough), then `time curl https://<worker>.workers.dev` ×5; record cold + warm numbers. **This number is the one that matters** — local Node timings don't reflect Workers isolate boot.
- [ ] Final smoke test against deployed URL: `curl > frame.bmp && magick frame.bmp frame.png`, eyeball against `to-bmp/out.bmp`
- [ ] Confirm `x-sleep-seconds` header present in `curl -I` against deployed URL
- [ ] Write `poc/worker/hand-off-next-steps.md` in the same style as `to-bmp/hand-off-next-steps.md`: what's proven (with real deploy numbers, not just local), decisions made, deferred questions, traps for the next agent

**Deploy gate:** All targets met against the deployed Worker. Bundle, cold-start, warm latency, and visual output documented from production. PoC is officially done.

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
