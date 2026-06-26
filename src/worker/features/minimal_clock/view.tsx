// View renderer for the minimal_clock layout. Lays out time + date as React/JSX
// and renders it via Satori → resvg, exposing both the intermediate SVG (ADR-0004
// diagnostics) and the rasterised 1-bit BMP, using DejaVu Sans Bold (ADR-0009).

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import { batteryIndicator } from '../../shared/battery/indicator';
import type { ViewModel } from './viewmodel';

// Folded into the weak ETag (ADR-0013). Bump whenever this file changes the
// rendered appearance without changing the view model — sizing, spacing,
// styling — so radiators holding a matching ETag redraw on their next wake.
// v2: added the top-right battery indicator (#131).
export const LAYOUT_VERSION = 2;

const FAMILY = 'DejaVu Sans';
const BLACK = '#000';
const WHITE = '#fff';

// DejaVu's proportional "HH:MM" is far narrower than the old mono glyphs, so the
// time can grow into the reclaimed width (ADR-0009); both still clear the floor
// and fit vertically. Verify live per ADR-0009.
const TIME_SIZE = 200;
const DATE_SIZE = 64;

function layout(vm: ViewModel): ReactNode {
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: WHITE,
        color: BLACK,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FAMILY,
        fontWeight: 700,
      }}
    >
      {/* Self-positioning top-right; null when the reading is absent. */}
      {vm.battery ? batteryIndicator(vm.battery) : null}
      <div style={{ fontSize: TIME_SIZE, lineHeight: 1 }}>{vm.time}</div>
      <div style={{ fontSize: DATE_SIZE, lineHeight: 1, marginTop: 48 }}>{vm.date}</div>
    </div>
  );
}

// The intermediate Satori SVG for this view model. The diagnostics SVG variant
// (#20 / ADR-0004) returns it verbatim, and renderBmp rasterises this exact
// string — one render path, so the SVG a human inspects is byte-for-byte the
// input the BMP encoder saw.
export function renderSvg(vm: ViewModel): Promise<string> {
  return jsxToSvg(layout(vm));
}

export async function renderBmp(vm: ViewModel): Promise<Uint8Array> {
  const svg = await renderSvg(vm);
  const rgba = await svgToRgba(svg);
  return rgbaTo1BitBmp(rgba);
}
