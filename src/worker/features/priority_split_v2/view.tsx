// Render pipeline for priority_split_v2: takes the shared JSX tree from
// layout.tsx through Satori → resvg, exposing the intermediate SVG (ADR-0004)
// and the rasterised 1-bit BMP. The tree itself lives in layout.tsx so a
// standalone render-fit harness can render the exact production layout without
// the sandbox-only wasm imports below (issue #108). DejaVu Sans Bold throughout
// (ADR-0009).

import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp } from '../../shared/bmp';
import { layout } from './layout';
import type { PrioritySplitV2ViewModel } from './viewmodel';

// Folded into the weak ETag (ADR-0013). Bump whenever the rendered appearance
// changes without changing the view model — sizing, spacing, styling, whether
// the change lands here or in layout.tsx — so radiators holding a matching ETag
// redraw on their next wake.
// v13: added the top-right battery indicator (#132).
export const LAYOUT_VERSION = 13;

// The intermediate Satori SVG for this view model. The diagnostics SVG variant
// (ADR-0004) returns it verbatim, and renderBmp rasterises this exact string —
// one render path, so the SVG a human inspects is byte-for-byte the input the
// BMP encoder saw.
export function renderSvg(vm: PrioritySplitV2ViewModel): Promise<string> {
  return jsxToSvg(layout(vm));
}

export async function renderBmp(vm: PrioritySplitV2ViewModel): Promise<Uint8Array> {
  const svg = await renderSvg(vm);
  const rgba = await svgToRgba(svg);
  return rgbaTo1BitBmp(rgba);
}
