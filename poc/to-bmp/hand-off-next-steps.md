# Hand-off: `to-bmp` PoC → next PoC

**Read first:** [`plan.md`](./plan.md) — full design, BMP1 header table, encoder rationale, references.
**Context:** [`../../docs/PRD/GottaGo PRD v0.4.md`](../../docs/PRD/GottaGo%20PRD%20v0.4.md) §7 "Pre-implementation spikes required" — this PoC fulfils the BMP-encoder half of that spike. Glossary is in `../../docs/glossary.md`.

## What this PoC proved

**End-to-end working pipeline, Node-hosted, ready to lift into a Cloudflare Worker:**

```
SVG string ─► resvg-wasm.render() ─► RGBA Uint8Array ─► luminance threshold + bit-pack ─► BMP1 (62-byte header + 64,800 bytes pixel data) ─► out.bmp
```

Verified:

- `@resvg/resvg-wasm` rasterises SVG to RGBA at 960×540 with no native deps — confirmed Workers-compatible at the library level.
- Hand-rolled BMP1 encoder produces a **spec-compliant** 64,862-byte file.
- Header bytes verified by direct inspection (`od -An -tx1 -N 62 out.bmp`); every field matches the table in `plan.md`.
- ImageMagick round-trip succeeds: `magick out.bmp out.png` reports `960 x 540, 1-bit grayscale, non-interlaced` — third-party validator agrees the file is well-formed.
- Visual eyeball test on `out.bmp` shows recognisable two-column priority_split mockup (LEAVE IN hero, Tier 2/3, marker track) in Press Start 2P. No skew, no banding, no row-order issues.
- Synthetic test pattern (`pnpm render:pattern`) — checkerboard + diagonal — renders cleanly, confirming MSB-first bit-packing and 120-byte row stride.

### Performance (Node, warm)

- Resvg raster: **60–250 ms** (cold isolate adds ~80 ms for `initWasm`)
- BMP encode + threshold: **15–60 ms**
- Total: **well under 1 second** target

Workers warm path should be comparable or faster — V8 isolate, JIT-optimised hot code, no fs round-trips.

## Decisions made (and why) — don't redo these

| Decision | Why | Where to revisit |
|---|---|---|
| **resvg-wasm** over alternatives | Only mature SVG→raster lib that runs in Workers; ~500 KB combined with Satori; clean `.render().pixels` API | Only if bundle pressure becomes critical |
| **Hand-rolled BMP encoder** over `bmp-ts` etc. | BMP1 header is 62 fixed bytes; libs add Buffer dependencies and aren't Workers-tested; encoder is <50 lines | Never. It's done. |
| **Hard luminance threshold @ 128** over Floyd–Steinberg | Press Start 2P + UI chrome has no continuous-tone regions; dither shimmer looks like dust on EPD and persists between refreshes | If photos/gradients land in a future layout — gate dithering per-region |
| **Top-down row order** (`biHeight = -540`) | Most EPD firmware expects top-down; writing rows in natural order matches loop direction | **Real hardware test** — if LilyGO firmware wants bottom-up, flip sign + reverse loop |
| **Palette idx 0 = white, idx 1 = black** | "Bit set = ink on" matches EPD framebuffer mental model | Never |
| **`font.fontBuffers` explicit registration** | resvg-wasm silently drops text it can't resolve — no system fonts, no fallbacks. **Biggest gotcha discovered.** | Inherits to Worker port — bundle TTF as static asset |
| **Press Start 2P at 80 px hero (not 120 px per PRD)** | Press Start 2P is fixed-width; 5-char "7 MIN" at 120 px = 600 px, blows out a 460 px column | Real layout work happens in the layout PoC, not here |

## What's in this directory

| File | Purpose |
|---|---|
| `plan.md` | Full design doc — header tables, encoder rationale, references |
| `index.ts` | Working pipeline: load SVG → resvg → BMP → write file. `--pattern` flag for synthetic test |
| `input.svg` | Hand-crafted two-column priority_split mockup, Press Start 2P |
| `PressStart2P-Regular.ttf` | Production font (118 KB, OFL, from Google Fonts repo) — bundle this in the Worker |
| `mise.toml` / `pnpm-workspace.yaml` / `package.json` | Toolchain — mise for Node, pnpm for packages, esbuild postinstall allowed |
| `out.bmp` / `pattern.bmp` | Generated outputs (gitignored) |

Re-run: `pnpm install && pnpm render` (or `pnpm render:pattern`).

## Open questions deliberately deferred

1. **Real hardware row order.** Top-down is the bet. Until the firmware PoC flashes an actual `.bmp` to the LilyGO T5 panel, this is unverified. If the panel renders upside-down, flip `biHeight` sign in `rgbaTo1BitBmp()`.
2. **Worker cold-start cost for `initWasm`.** Measured at ~80 ms in Node, but Workers boot dynamics differ. Needs `wrangler dev` benchmarking. If > 200 ms, may need to pre-warm or accept first-frame lag after deploys.
3. **Bundle size when Satori is added.** Plan estimates ~500 KB gzipped for Satori + Resvg + Press Start 2P TTF — should fit the 3 MiB free-tier limit comfortably, but unverified. Confirm with `wrangler deploy --dry-run --outdir dist`.
4. **Satori → resvg integration mechanics.** `satori-react/` PoC produces SVG; this PoC consumes SVG. The seam is a string. But Satori has specific quirks (image fetcher, `satori-html` size limits) — see the "Pitfalls" link in `plan.md`'s references.
5. **`X-Sleep-Seconds` header logic** — none of this is in scope here. Belongs to the Worker PoC.

## Next PoC — `worker` (recommended scope)

**Goal:** Wrap Satori + this BMP pipeline in a Cloudflare Worker. End-to-end: HTTP request → JSX layout → BMP response. No Metlink yet — feed it static fake data.

### Concrete first steps

1. **Scaffold a fresh `poc/worker/` directory** using `pnpm create cloudflare@latest` with the **"Hello World" TypeScript** template. Don't add Satori/resvg at creation time — add them incrementally.
2. **Port the BMP encoder.** Copy `rgbaTo1BitBmp()` from `index.ts` verbatim into `src/bmp.ts`. It's pure JS with no Node deps — zero changes needed. Add a unit test that asserts output length = 64,862 and header bytes match the spec.
3. **Wire resvg-wasm with static wasm import:**
   ```ts
   import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
   import { initWasm, Resvg } from '@resvg/resvg-wasm';
   let wasmReady: Promise<void> | null = null;
   const ensureWasm = () => (wasmReady ??= initWasm(resvgWasm));
   ```
   This is the only structural difference from the Node version — `readFile` becomes a static import. Wrangler ≥3.15 handles `.wasm` imports natively; pin a recent Wrangler.
4. **Bundle the font as a static asset:**
   ```ts
   import pressStartTtf from './PressStart2P-Regular.ttf';
   ```
   Then pass it to the `Resvg` constructor in `font.fontBuffers` exactly as `index.ts` does today. **Don't skip the `defaultFontFamily: 'Press Start 2P'` option** — resvg drops text silently if it can't resolve the family.
5. **Add Satori on top.** Cross-reference `../satori-react/index.jsx` for the working JSX→SVG call shape. The seam between Satori and resvg is a plain SVG string — Satori returns it, resvg accepts it.
6. **Pre-fetch all images and inline as `data:` URLs** before passing the tree to Satori. Satori's image fetcher behaves oddly under the Workers fetch context — see [the dev.to pitfalls writeup](https://dev.to/devoresyah/6-pitfalls-of-dynamic-og-image-generation-on-cloudflare-workers-satori-resvg-wasm-1kle) linked in `plan.md`.
7. **Return BMP via the request handler:**
   ```ts
   return new Response(bmp, {
     headers: {
       'content-type': 'image/bmp',
       'x-sleep-seconds': '120',   // hardcode for now; profile-phase logic comes later
     },
   });
   ```
8. **Measure bundle size:** `wrangler deploy --dry-run --outdir dist && du -sh dist/`. Target: under 3 MiB compressed. If it blows out, the prime suspect is duplicated wasm or accidentally bundled fonts beyond Press Start 2P.
9. **Measure cold-start latency** with `wrangler dev` and a simple `time curl` loop. The first request after deploy is the worst case — that's what the radiator will hit on Worker redeploys.
10. **Smoke test:** `curl localhost:8787 -o frame.bmp && magick frame.bmp frame.png` and eyeball `frame.png`. If it matches `poc/to-bmp/out.bmp` visually, the Worker port is correct.

### Out of scope for the Worker PoC

- Metlink API integration (separate PoC — `poc/metlink/` already exists)
- KV caching (do this once Metlink is wired in)
- Profile-phase resolution from server time
- `X-Radiator-Slug` / `X-Radiator-Token` auth
- Real hardware test against LilyGO panel (firmware PoC owns this)

Keep the Worker PoC tightly scoped to: **"can Satori + resvg + the BMP encoder run together in a Worker and return a valid BMP under 1 second?"** Everything else is a separate experiment.

## Likely traps for the next agent

- **Don't `npm install`.** Use `pnpm` per the toolchain convention. `mise install && pnpm install`.
- **Don't add Buffer-flavoured BMP libs.** `bmp-ts` and friends pull in Node `Buffer` polyfills that bloat the Worker bundle. The hand-rolled encoder is intentionally Buffer-free — keep it that way.
- **Don't switch to `loadSystemFonts: true` thinking it'll be a safety net.** Workers has no system fonts. The flag does nothing useful there; explicit TTF bundling is the only path.
- **Don't trust resvg to warn about missing fonts.** It silently drops text. If you see blank text in the output, the font registration is wrong — check `defaultFontFamily` matches the TTF's internal family name.
- **Don't use `font-family="monospace"` or other generic families in the SVG.** Use the exact registered family name (`Press Start 2P`).
- **Don't worry about Buffer vs Uint8Array.** `rgbaTo1BitBmp()` returns `Uint8Array`, which is what `new Response(...)` wants. No conversion needed.
- **Don't try to skip Satori and write SVG by hand for the Worker PoC.** That's what `to-bmp` already did. The Worker PoC's value is proving the Satori + resvg seam works under Workers — not re-validating the encoder.
