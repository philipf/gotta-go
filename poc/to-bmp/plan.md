# PoC: SVG → 1-bit BMP pipeline (`to-bmp`)

## Goal

Prove the second half of the GottaGo rendering pipeline end-to-end: take an SVG (the kind Satori produces) and emit a **valid 1-bit monochrome BMP at 960×540** that a LilyGO T5 4.7" e-paper panel can flush directly.

This PoC stops short of the Worker — it runs as a Node script with `tsx`, mirroring the `satori-react/` PoC layout. Workers compatibility is verified at the **library-choice level** (resvg-wasm, no native deps); a follow-up PoC will wire it into a real Worker.

## Scope

In scope:
- SVG (string or file) → RGBA pixel buffer via `@resvg/resvg-wasm`.
- RGBA → packed 1-bit pixel data with luminance threshold at 128.
- Hand-rolled BMP1 header (14 + 40 + 8 = 62 bytes) + pixel data.
- Write `out.bmp` to disk; open it in a viewer to eyeball correctness.
- A second sanity check: render a known-good test pattern (checkerboard + diagonal line + Press Start 2P text) so threshold and packing bugs are visually obvious.

Out of scope (deferred):
- Cloudflare Worker wrapping (next PoC).
- Floyd–Steinberg dithering.
- Sending the BMP over Wi-Fi to the actual LilyGO panel (separate firmware PoC).
- Satori integration — feed it a hand-crafted SVG or reuse `../satori-react/hello-jsx.svg`.

## Environment

Tooling: **mise** for runtime pinning, **pnpm** for packages. No global npm installs.

### `mise.toml`

```toml
[tools]
node = "latest"
```

Match the `satori-react/` PoC — `node = "latest"` is fine because resvg-wasm has no native build step.

### `pnpm-workspace.yaml`

```yaml
allowBuilds:
  esbuild: true
```

(Required because `tsx` pulls in esbuild, which has a postinstall step pnpm blocks by default.)

### `package.json`

```json
{
  "type": "module",
  "scripts": {
    "render": "tsx index.ts",
    "render:pattern": "tsx index.ts --pattern"
  },
  "dependencies": {
    "@resvg/resvg-wasm": "^2.6.2"
  },
  "devDependencies": {
    "tsx": "^4.22.1",
    "@types/node": "^22.0.0"
  }
}
```

### One-time setup

```bash
cd poc/to-bmp
mise install            # pulls Node per mise.toml
pnpm install            # installs deps into local node_modules
pnpm render             # runs the pipeline → writes out.bmp
```

If `mise` isn't already trusting this directory:

```bash
mise trust
```

## Pipeline architecture

```
SVG string ──► resvg-wasm.render() ──► RGBA Uint8Array (960·540·4)
                                              │
                                              ▼
                            luminance threshold + bit-pack
                                              │
                                              ▼
                                  pixel data (120·540 bytes)
                                              │
                                              ▼
                              prepend 62-byte BMP1 header
                                              │
                                              ▼
                                         out.bmp
```

### Stage A — SVG → RGBA (`@resvg/resvg-wasm`)

Initialise once at module scope (matters in Workers; harmless in Node):

```ts
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFile } from 'node:fs/promises';

const wasm = await readFile(
  new URL('../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)
);
await initWasm(wasm);

const svg = await readFile('./input.svg', 'utf8');
const r = new Resvg(svg, { fitTo: { mode: 'width', value: 960 } });
const rgba = r.render().pixels;   // Uint8Array, length = 960*540*4
```

Note for the Worker port later: replace the `readFile` of the wasm with a static `import wasm from '@resvg/resvg-wasm/index_bg.wasm'` — Wrangler ≥3.15 handles wasm imports natively.

**Font gotcha — must be explicitly registered.** `@resvg/resvg-wasm` has zero font access by default: no system fonts, no fallbacks. Any `<text>` element whose `font-family` it can't resolve is **silently dropped** — no warning, no tofu, just missing text. The fix is to load the TTF buffer and pass it to the `Resvg` constructor:

```ts
const fontTtf = await readFile(new URL('./PressStart2P-Regular.ttf', import.meta.url));
const r = new Resvg(svg, {
  fitTo: { mode: 'width', value: 960 },
  font: {
    fontBuffers: [fontTtf],
    defaultFontFamily: 'Press Start 2P',
    loadSystemFonts: false,            // explicit; wasm default anyway
  },
});
```

The SVG's `font-family="…"` value must match the **internal TTF family name** (Press Start 2P's is `Press Start 2P`), not just a label of your choosing. In the Worker port, swap `readFile` for a static `import font from './PressStart2P-Regular.ttf'` — same pattern, statically bundled. Press Start 2P is fixed-width with a minimal glyph set — every char is roughly `font-size` wide, and unsupported characters (e.g. middle dot `·`) render as missing-glyph boxes, so size text against `chars × font-size` ≤ column width and stick to ASCII punctuation.

### Stage B — RGBA → 1-bit BMP (hand-rolled)

#### BMP1 layout (960×540)

| Offset | Size | Field                    | Value                                  |
|--------|------|--------------------------|----------------------------------------|
| 0      | 2    | `'BM'` signature         | `0x42 0x4D`                            |
| 2      | 4    | File size (LE)           | `62 + 120·540 = 64,862`                |
| 6      | 4    | Reserved                 | 0                                      |
| 10     | 4    | Pixel data offset        | `62`                                   |
| 14     | 4    | DIB header size          | `40`                                   |
| 18     | 4    | Width                    | `960` (signed LE)                      |
| 22     | 4    | Height                   | `-540` (top-down rows)                 |
| 26     | 2    | Planes                   | `1`                                    |
| 28     | 2    | **biBitCount**           | `1`                                    |
| 30     | 4    | biCompression            | `0` (BI_RGB)                           |
| 34     | 4    | biSizeImage              | `120 · 540 = 64,800`                   |
| 38     | 8    | ppm X/Y + reserved       | `0,0,0,0`                              |
| 46     | 4    | biClrUsed                | `2`                                    |
| 50     | 4    | biClrImportant           | `0`                                    |
| 54     | 4    | Palette idx 0 (BGRA)     | `FF FF FF 00` → **white**              |
| 58     | 4    | Palette idx 1 (BGRA)     | `00 00 00 00` → **black**              |
| 62…    | …    | Packed pixel data        | row-major, MSB-first, 120 bytes/row    |

Key decisions and their rationale:

- **Row size**: `960 / 8 = 120` bytes — already a multiple of 4, so **no row padding** is needed. (BMP requires rows to be 4-byte aligned; we get it for free.)
- **`biHeight = -540` (negative)**: makes BMP top-down, so we write rows in natural reading order. LilyGO EPD firmware typically expects top-down; if real hardware testing later shows otherwise, flip to positive 540 and reverse the row loop.
- **Palette index 0 = white, index 1 = black**: "bit set = ink on", which matches how most EPD framebuffers think. Easier mental model when debugging.
- **MSB-first within each byte**: leftmost pixel of a group of 8 lands in bit 7. This is the BMP spec, not a convenience choice.
- **Threshold at luminance 128 using Rec.601** (`0.299·R + 0.587·G + 0.114·B`), with alpha treated as blending toward white (transparent regions read as paper, not ink). Floyd–Steinberg dithering is deliberately skipped — Press Start 2P + Satori UI chrome has no continuous-tone regions, and edge shimmer on an EPD survives between refreshes and looks like dust.

#### Encoder sketch

```ts
function rgbaTo1BitBmp(rgba: Uint8Array, w = 960, h = 540): Uint8Array {
  const rowBytes = w >> 3;                    // 120 for 960
  const pixels = new Uint8Array(rowBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum =
        a * (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) +
        (1 - a) * 255;
      if (lum < 128) pixels[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const buf = new Uint8Array(62 + pixels.length);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4D;
  dv.setUint32(2,  buf.length, true);
  dv.setUint32(10, 62,         true);
  dv.setUint32(14, 40,         true);
  dv.setInt32(18,  w,          true);
  dv.setInt32(22,  -h,         true);
  dv.setUint16(26, 1,          true);
  dv.setUint16(28, 1,          true);
  dv.setUint32(34, pixels.length, true);
  dv.setUint32(46, 2,          true);
  buf.set([0xFF,0xFF,0xFF,0x00, 0x00,0x00,0x00,0x00], 54);
  buf.set(pixels, 62);
  return buf;
}
```

## Files to create

- `mise.toml` — Node pin.
- `pnpm-workspace.yaml` — allow esbuild postinstall.
- `package.json` — deps + scripts.
- `index.ts` — entrypoint; loads `input.svg`, runs the pipeline, writes `out.bmp`. With `--pattern`, generates the synthetic test SVG instead.
- `input.svg` — a small hand-crafted 960×540 SVG (black/white shapes + some text). Reuse `../satori-react/hello-jsx.svg` as a second sample if convenient.
- `.gitignore` — `node_modules/`, `*.bmp`.

No tests in this PoC — the verification is visual.

## Verification checklist

After `pnpm render`, confirm each of these before declaring the spike done:

1. `out.bmp` exists, file size is exactly **64,862 bytes**.
2. Opening `out.bmp` in an image viewer (Loupe, eog, Preview, GIMP) shows a recognisable rendering — no skew, no diagonal banding (banding = row-size or padding bug; skew = endianness or row-order bug).
3. The synthetic test pattern (`pnpm render:pattern`) shows:
   - A clean checkerboard (single-pixel cells) — proves bit packing is MSB-first and rows align.
   - A solid 1-pixel diagonal from `(0,0)` to `(959,539)` — proves row stride is exactly 120 bytes.
   - Press Start 2P text reads crisply — confirms the threshold value isn't eating glyph strokes.
4. `xxd out.bmp | head -8` shows the expected header bytes (`42 4D` at offset 0, `3E 00 00 00` for pixel-offset at offset 10).
5. Round-trip sanity: `convert out.bmp out.png` (ImageMagick) succeeds without warnings — proves the header is spec-compliant.

If any of these fail, the bug is almost always in the header (wrong field offset / endianness) or the bit-packing loop (MSB vs LSB, or `x >> 3` vs `x / 8` int coercion).

## Open questions for the next PoC

- **Worker bundle size**: confirm `@resvg/resvg-wasm` + Satori + Press Start 2P TTF stays under the 3 MiB free-tier limit. Measure with `wrangler deploy --dry-run --outdir dist` once wrapped.
- **Cold-start cost**: time `initWasm` on a cold isolate. If > 200 ms, the radiator's first frame after a Worker redeploy will feel sluggish — may need to pre-warm.
- **Real hardware confirmation**: top-down vs bottom-up row order on the actual LilyGO panel. Adjust `biHeight` sign accordingly.
- **Dithering**: revisit only if a future layout introduces photos or gradients. Default stays at hard threshold.

## References

- [@resvg/resvg-wasm on npm](https://www.npmjs.com/package/@resvg/resvg-wasm)
- [resvg-js upstream repo](https://github.com/thx/resvg-js)
- [BMP file format — Wikipedia](https://en.wikipedia.org/wiki/BMP_file_format)
- [Tom Sherman — Dynamic OG Images with Cloudflare Workers](https://tom-sherman.com/blog/dynamic-og-image-cloudflare-workers) (bundle-size baseline)
- [Pitfalls of Satori + resvg-wasm on Workers](https://dev.to/devoresyah/6-pitfalls-of-dynamic-og-image-generation-on-cloudflare-workers-satori-resvg-wasm-1kle)
- GottaGo PRD v0.4 §7 "Pre-implementation spikes required" — this PoC fulfils the BMP half of that spike.
