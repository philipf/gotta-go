// Spike for GH #33: does an inline-SVG `<img>` ModeIcon rasterise through the
// real Satori -> resvg -> 1-bit BMP pipeline, pixel-exactly, vs the literal
// "one <div> per on-pixel" approach the issue's acceptance criteria spell out?
//
// We render the BUS and TRAIN mode icons three ways and, for each, check:
//   1. did resvg actually rasterise it?            (black pixels > 0)
//   2. is it pixel-exact?                          (black == onCells * P^2)
//   3. is it crisp (no anti-aliasing fuzz)?        (no intermediate-luma px)
//   4. how long did Satori + resvg take?           (the "faster" claim)
//
// A pixel-exact, fuzz-free render proves the inline-SVG route is both viable
// AND crisp on a 1-bit panel. If the <img> route renders 0 black pixels, resvg
// didn't rasterise the embedded SVG and divs are the safe fallback.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import React from "react";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

// --- Pixel grids, verbatim from the HTML spec (issue #33, lines 540-546) -----

const BUS = [
  ".############.",
  ".############.",
  ".#...#..#...#.",
  ".#...#..#...#.",
  ".#...#..#...#.",
  ".############.",
  ".############.",
  "##############",
  "..##......##..",
  "..##......##..",
];

const TRAIN = [
  ".############.",
  ".############.",
  ".##...##...##.",
  ".##...##...##.",
  ".##...##...##.",
  ".############.",
  ".#####..#####.",
  ".#####..#####.",
  ".############.",
  "##############",
  "..###....###..",
  ".....####.....",
];

type Grid = string[];

const cols = (g: Grid) => g[0].length;
const rows = (g: Grid) => g.length;
const onCells = (g: Grid) =>
  g
    .join("")
    .split("")
    .filter((c) => c === "#").length;

function* onPixels(g: Grid): Generator<[number, number]> {
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[y].length; x++) if (g[y][x] === "#") yield [x, y];
}

// --- Strategy A: one absolutely-positioned <div> per on-pixel (issue's AC) ----

function iconDivs(g: Grid, P: number): React.ReactElement {
  const squares = [...onPixels(g)].map(([x, y], i) =>
    React.createElement("div", {
      key: i,
      style: {
        position: "absolute",
        left: x * P,
        top: y * P,
        width: P,
        height: P,
        backgroundColor: "#000",
      },
    }),
  );
  return React.createElement(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        width: cols(g) * P,
        height: rows(g) * P,
      },
    },
    squares,
  );
}

// --- Build an SVG string from the grid (rects, or one merged path) -----------

function gridSvg(g: Grid, P: number, mode: "rects" | "path"): string {
  const w = cols(g) * P;
  const h = rows(g) * P;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${cols(g)} ${rows(g)}" shape-rendering="crispEdges">`;
  if (mode === "rects") {
    const rects = [...onPixels(g)]
      .map(
        ([x, y]) =>
          `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`,
      )
      .join("");
    return `${head}${rects}</svg>`;
  }
  const d = [...onPixels(g)].map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("");
  return `${head}<path d="${d}" fill="#000"/></svg>`;
}

// SVG-side compensation: same grid, but cells are Pw wide x Ph tall instead of
// square. preserveAspectRatio="none" lets the viewBox squash horizontally;
// integer Pw/Ph keep every edge on a device-pixel boundary, so it stays crisp.
// The "pixels" just become rectangles -- no grid redraw, narrower aspect.
function gridSvgWH(g: Grid, Pw: number, Ph: number): string {
  const rects = [...onPixels(g)]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols(g) * Pw}" height="${rows(g) * Ph}" viewBox="0 0 ${cols(g)} ${rows(g)}" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// --- Strategies B/C: a single <img> holding the inline SVG --------------------

function iconImg(
  g: Grid,
  P: number,
  mode: "rects" | "path",
): React.ReactElement {
  const w = cols(g) * P;
  const h = rows(g) * P;
  return React.createElement("img", {
    src: svgDataUri(gridSvg(g, P, mode)),
    width: w,
    height: h,
    style: { width: w, height: h },
  });
}

// --- Canvas wrapper (white field, like the layout would supply) --------------

function canvas(
  child: React.ReactElement,
  w: number,
  h: number,
): React.ReactElement {
  return React.createElement(
    "div",
    {
      style: { display: "flex", width: w, height: h, backgroundColor: "#fff" },
    },
    child,
  );
}

// --- Pipeline ----------------------------------------------------------------

const FAMILY = "Press Start 2P";

function rgbaStats(rgba: Uint8Array) {
  let black = 0;
  let fuzz = 0; // intermediate luminance => anti-aliasing
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    const lum =
      a * (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) +
      (1 - a) * 255;
    if (lum < 128) black++;
    if (lum > 10 && lum < 245) fuzz++;
  }
  return { black, fuzz };
}

type Strategy = "divs" | "img-rects" | "img-path";

async function run() {
  // resvg wasm + font, same as the to-bmp poc.
  const wasm = await readFile(
    new URL("./node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url),
  );
  await initWasm(wasm);
  const font = await readFile(
    new URL("./PressStart2P-Regular.ttf", import.meta.url),
  );

  await mkdir(new URL("./out/", import.meta.url), { recursive: true });

  const P = 8; // device pixels per source pixel (integer multiple)
  const icons: Array<[string, Grid]> = [
    ["bus", BUS],
    ["train", TRAIN],
  ];
  const strategies: Strategy[] = ["divs", "img-rects", "img-path"];

  console.log(`P=${P} px/cell\n`);
  console.log(
    "icon  strategy    black  expect  exact  fuzz  satori  resvg".padEnd(64),
  );
  console.log("-".repeat(64));

  for (const [name, g] of icons) {
    const W = cols(g) * P + 16;
    const H = rows(g) * P + 16;
    const expect = onCells(g) * P * P;

    for (const strat of strategies) {
      const icon =
        strat === "divs"
          ? iconDivs(g, P)
          : iconImg(g, P, strat === "img-rects" ? "rects" : "path");

      const t0 = performance.now();
      const svg = await satori(canvas(icon, W, H), {
        width: W,
        height: H,
        fonts: [{ name: FAMILY, data: font, weight: 400, style: "normal" }],
      });
      const t1 = performance.now();
      const rgba = new Resvg(svg, {
        fitTo: { mode: "width", value: W },
        font: {
          fontBuffers: [font],
          defaultFontFamily: FAMILY,
          loadSystemFonts: false,
        },
      }).render().pixels;
      const t2 = performance.now();

      const { black, fuzz } = rgbaStats(rgba);
      const exact = black === expect ? "YES" : "no";

      await writeFile(
        new URL(`./out/${name}-${strat}.svg`, import.meta.url),
        svg,
      );

      console.log(
        `${name.padEnd(6)}${strat.padEnd(12)}${String(black).padEnd(7)}${String(expect).padEnd(8)}${exact.padEnd(7)}${String(fuzz).padEnd(6)}${(t1 - t0).toFixed(1).padStart(6)}${(t2 - t1).toFixed(1).padStart(7)}`,
      );
    }
  }
  console.log(
    "\nblack==expect & fuzz==0  => inline-SVG <img> rasterises pixel-exact and crisp.",
  );
  console.log(
    "black==0                 => resvg did NOT rasterise the embedded SVG; use divs.",
  );
  console.log("\nInspect out/*.svg to see how Satori embedded each icon.");

  // --- SVG-side compensation demo --------------------------------------------
  // Can we narrow WITHOUT redrawing the grid, by squashing cells horizontally?
  // Yes, and fuzz stays 0 as long as Pw (cell width) is a whole device pixel.
  console.log("\nSVG-side compensation (14-wide grid kept, non-square cells):");
  console.log("icon   cell WxH   icon px    aspect  fuzz");
  console.log("-".repeat(44));
  for (const [name, g] of icons) {
    for (const [Pw, Ph] of [
      [8, 8], // baseline: square pixels (today)
      [6, 8], // mild squash
      [5, 8], // stronger squash, ~portrait
    ] as const) {
      const w = cols(g) * Pw;
      const h = rows(g) * Ph;
      const img = React.createElement("img", {
        src: svgDataUri(gridSvgWH(g, Pw, Ph)),
        width: w,
        height: h,
        style: { width: w, height: h },
      });
      const svg = await satori(canvas(img, w + 16, h + 16), {
        width: w + 16,
        height: h + 16,
        fonts: [{ name: FAMILY, data: font, weight: 400, style: "normal" }],
      });
      const rgba = new Resvg(svg, {
        fitTo: { mode: "width", value: w + 16 },
        font: {
          fontBuffers: [font],
          defaultFontFamily: FAMILY,
          loadSystemFonts: false,
        },
      }).render().pixels;
      const { fuzz } = rgbaStats(rgba);
      await writeFile(
        new URL(`./out/${name}-cell${Pw}x${Ph}.svg`, import.meta.url),
        svg,
      );
      console.log(
        `${name.padEnd(7)}${`${Pw}x${Ph}`.padEnd(11)}${`${w}x${h}`.padEnd(11)}${(w / h).toFixed(2).padEnd(8)}${fuzz}`,
      );
    }
  }
  console.log(
    "\nfuzz==0 at every integer cell width => SVG-side squash stays crisp.",
  );

  // --- Chosen appearance: 5x8 non-square cells -------------------------------
  // Emit clean, standalone icon SVGs (black rects on transparent; the layout
  // supplies the white field) for dropping in elsewhere. These are the icons,
  // not the full-canvas Satori dumps in out/{name}-{strategy}.svg.
  await writeFile(
    new URL("./out/bus.svg", import.meta.url),
    gridSvgWH(BUS, 5, 8),
  );
  await writeFile(
    new URL("./out/train.svg", import.meta.url),
    gridSvgWH(TRAIN, 5, 8),
  );
  console.log("\nWrote chosen icons: out/bus.svg, out/train.svg (5x8 cells).");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
