// "Mode icon" — the custom 8-bit glyph identifying a transit target's mode
// (glossary: bus or train), shown to the left of the service name in a column
// header.
// Lives with priority_split — its sole consumer. Lift back to shared/ when a
// second transit feature needs it.
//
// Cells render NON-SQUARE at a fixed 5:8 (w:h) ratio: square pixels at the
// 14-wide grids read too wide (~1.4:1). It stays crisp on the 1-bit panel as
// long as the cell width is a whole device pixel, so Pw is rounded to an
// integer. The grid is the source of truth; the SVG is generated from it at
// render time (no bundled asset, no fetch, no new wrangler rule). Rasterisation
// is proven in poc/satori-mode-icons and verified live via `wrangler dev` (the
// Satori/resvg/yoga-wasm path is sandbox-blocked in vitest per ADR-0005).

import type { ReactElement } from 'react';

export type Mode = 'bus' | 'train';

// Source pixel grids. '#' = a black (on) cell; '.' = transparent — the layout
// supplies the white field. BUS is 14×10, TRAIN is 14×12 (symmetry-corrected).
export const MODE_GRIDS: Record<Mode, readonly string[]> = {
  bus: [
    '.############.',
    '.############.',
    '.#...#..#...#.',
    '.#...#..#...#.',
    '.#...#..#...#.',
    '.############.',
    '.############.',
    '##############',
    '..##......##..',
    '..##......##..',
  ],
  train: [
    '.############.',
    '.############.',
    '.##...##...##.',
    '.##...##...##.',
    '.##...##...##.',
    '.############.',
    '.#####..#####.',
    '.#####..#####.',
    '.############.',
    '##############',
    '..###....###..',
    '.....####.....',
  ],
};

// Cell aspect (width : height). Narrows the silhouette; see header comment.
const CELL_W = 5;
const CELL_H = 8;

// Cell width for a given cell height, at the 5:8 ratio, snapped to a whole
// device pixel. The integer snap is what keeps the icon crisp on a 1-bit panel.
function cellWidth(height: number): number {
  return Math.round((height * CELL_W) / CELL_H);
}

/** Count of "on" (black) cells in a grid. */
export function onCells(grid: readonly string[]): number {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell === '#') n++;
  return n;
}

/**
 * Build the icon SVG from a grid. `height` is the vertical size of one source
 * pixel in device pixels (Ph); total icon height is `rows × height`. Cell width
 * Pw is derived at the 5:8 ratio and snapped to a whole device pixel so every
 * rect edge lands on an integer boundary (crisp on a 1-bit panel).
 */
export function modeIconSvg(mode: Mode, height: number): string {
  const grid = MODE_GRIDS[mode];
  const Ph = height;
  const Pw = cellWidth(Ph);
  const cols = grid[0].length;
  const rows = grid.length;

  let rects = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === '#') {
        rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * Pw}" height="${rows * Ph}" ` +
    `viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    `${rects}</svg>`
  );
}

/**
 * Satori-compatible element: a single <img> holding the inline SVG as a base64
 * data URI, sized so the layout can drop it straight into a column header.
 * `height` is the per-source-pixel vertical size (see {@link modeIconSvg}).
 */
export function modeIcon({ mode, height }: { mode: Mode; height: number }): ReactElement {
  const grid = MODE_GRIDS[mode];
  const Pw = cellWidth(height);
  const w = grid[0].length * Pw;
  const h = grid.length * height;
  const src = `data:image/svg+xml;base64,${btoa(modeIconSvg(mode, height))}`;
  return <img src={src} width={w} height={h} style={{ width: w, height: h }} />;
}
