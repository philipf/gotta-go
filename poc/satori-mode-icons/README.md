# satori-mode-icons — spike for GH #33

**Question.** GH #33 specifies the bus/train mode icons as pixel-grid constants in
TS, rendered as "one black `<div>` per on-cell" through the existing
`satori → resvg → 1-bit BMP` pipeline. Before building that, two things were
worth de-risking empirically:

1. Could `ModeIcon` instead emit a **single inline-SVG `<img>`** (icon compiled
   from the *same* pixel grid) — a lighter Satori node — and would resvg
   actually rasterise it?
2. Would that stay **crisp** on a 1-bit panel, or would vector→raster→threshold
   introduce anti-aliasing fuzz the "snap to whole device pixels" rule forbids?

This is a source-format / render-strategy question only. The device consumes a
1-bit BMP either way; SVG is never the delivery format.

## Run

```sh
mise install        # node
pnpm install
pnpm spike          # renders bus + train × {divs, img-rects, img-path}
```

Writes the Satori output SVG for each variant to `out/` so you can see how the
icon was embedded.

## Result

All three strategies render **pixel-exact** (`black == onCells × P²`) and
**fuzz-free** (zero intermediate-luminance pixels) at integer pixel size P=8:

```
icon  strategy    black  expect  exact  fuzz  satori  resvg
bus   divs        5248   5248    YES    0       23.8   17.5   <- 167 <rect> nodes
bus   img-rects   5248   5248    YES    0        1.5   10.1   <- 1 <image> node
bus   img-path    5248   5248    YES    0        0.7    2.9   <- 1 <image> node
train divs        6848   6848    YES    0       ...
train img-rects   6848   6848    YES    0        ...
train img-path    6848   6848    YES    0        ...
```

(satori/resvg ms are noisy at this scale; the divs vs img Satori-layout gap is
the one repeatable difference across runs.)

## Findings

- **The inline-SVG `<img>` route works.** Satori emits
  `<image href="data:image/svg+xml;base64,…">` and resvg rasterises the embedded
  SVG. Pixel-exact, no fuzz — crisp on a 1-bit panel. The main technical risk is
  retired.
- **divs make Satori do real layout work.** The grid expands to **167 `<rect>`**
  elements in the output SVG (one per on-pixel); Satori's Yoga pass on those is
  the ~20ms. The `<img>` route is one node (~1ms layout). Real and repeatable,
  but ~20ms/icon is small next to cold-start wasm init — it only matters once
  `priority_split` (#5/#6) puts several icons in a frame.
- **Crispness is not the differentiator** — both are exact because P is an
  integer multiple and the SVG uses integer coords + `shape-rendering="crispEdges"`.

## Recommendation for #33

Keep the **pixel grid as the TS source of truth** (as the issue decided — single
diffable source, no `wrangler` bundling rule, no fetch). Have `ModeIcon` compile
the grid into a **single inline-SVG `<img>`** rather than N divs: same source of
truth, cleaner/lighter Satori node, verified to rasterise crisp.

`img-path` and `img-rects` are equivalent in output; `img-rects` is simpler to
generate and read. Divs remain the boring-safe fallback if a future Satori/resvg
bump regresses `<image>` data-URI handling — hence this spike, which doubles as a
regression check.

## Appearance decisions (icon shape)

Reviewing the first renders surfaced two issues with the grids as transcribed
from the HTML spec:

1. **TRAIN windows were asymmetric.** Spec rows 2–4 were `.##...##....#.`
   (right frame 1px, windows 3px + 4px). Corrected to `.##...##...##.` —
   palindromic, frames 2/2/2px, two equal 3px windows. **This fix should also be
   pushed back to the canonical grid in `docs/UI/transit-radiator-ui-spec-no-design-system.html`
   (and any baked mockup), which still carries the asymmetric version.**
2. **Icons looked too wide.** Square pixels at the 14-wide grid give the bus a
   1.40:1 aspect. The render is geometrically faithful (it matches the spec's own
   `pixelMap()`); the ASCII only *looks* narrower because monospace glyphs are
   tall. Two crisp ways to narrow it, both verified `fuzz==0`:
   - **redraw narrower** (fewer columns) → true square pixels, but loses window
     detail as it narrows;
   - **SVG-side compensation** → keep the 14-wide grid, render cells as
     non-square integer rects via `gridSvgWH(g, Pw, Ph)` + `preserveAspectRatio="none"`.
     Stays crisp as long as `Pw` is a whole device pixel; the only cost is
     rectangular ("squished") pixels.

   **Chosen: SVG-side compensation at `Pw=5, Ph=8`** — keeps all the spec detail
   and the corrected symmetry, bus 0.88:1, train 0.73:1. `pnpm spike` emits the
   clean standalone icons to `out/bus.svg` and `out/train.svg`.

Implication for #33: the `ModeIcon` helper carries a fixed **5:8 cell ratio**
(width:height), not a single square `pixelSize`. Drive it by the vertical pixel
size and derive `Pw = round(Ph * 5/8)` as an integer to keep edges crisp — don't
let a consumer set an arbitrary width/height ratio (the standalone `out/*.svg`
use `preserveAspectRatio="none"`, so a non-70:80 box would re-squash them).
