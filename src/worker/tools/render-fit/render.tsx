// Render-fit harness for priority_split_v2 (issue #108). Builds the worst-case
// and reference view models that live Metlink data will not reliably produce,
// then renders each through the *exact* production tree (layout.tsx) and the
// *exact* production rasteriser settings (Satori → resvg → 1-bit BMP, matching
// shared/satori.ts + shared/bmp.ts). The output is therefore a faithful preview
// of what the panel shows, so the LATER_COUNT / slot-sizing decisions in
// priority_split_v2_delta §6 can be made against real pixels, not a mockup.
//
// Run it via the sibling run.mjs (pnpm render:fit) — that bundles this file with
// the repo's own esbuild and supplies the font / wasm / output paths as env.
// Each scenario writes a vector `.svg` (open in a browser) and a 1-bit `.bmp`
// (the true panel preview) into ./out.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { layout } from '../../features/priority_split_v2/layout';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import type {
  DepartureSlot,
  LastSlot,
  LaterRow,
  PrioritySplitV2ViewModel,
  ServiceColumn,
} from '../../features/priority_split_v2/viewmodel';

const FAMILY = 'DejaVu Sans';

const fontPath = process.env.RENDER_FIT_FONT!;
const resvgWasmPath = process.env.RENDER_FIT_RESVG_WASM!;
const outDir = process.env.RENDER_FIT_OUT!;

const fontBuffer = new Uint8Array(readFileSync(fontPath));

// ── view-model builders ─────────────────────────────────────────────────────
// Terse helpers so each scenario reads as data, not boilerplate.

function slot(leaveIn: string, leaveBy: string, arrives: string, extra: Partial<DepartureSlot> = {}): DepartureSlot {
  return { leaveIn, leaveBy, arrives, deviation: null, cancelled: false, routePrefix: '', ...extra };
}
// `clock` is the bare hh:mm; mirrors the domain by prefixing `BY ` for a live
// row and leaving a cancelled row's struck scheduled clock bare (#108).
function later(leaveIn: string, clock: string, extra: Partial<LaterRow> = {}): LaterRow {
  const cancelled = extra.cancelled ?? false;
  return { leaveIn, clock: cancelled ? clock : `BY ${clock}`, deviation: null, cancelled: false, routePrefix: '', ...extra };
}
function last(tag: string, leaveIn: string, arrives: string, extra: Partial<LastSlot> = {}): LastSlot {
  return { tag, leaveIn, arrives, deviation: null, cancelled: false, routePrefix: '', ...extra };
}
function col(over: Partial<ServiceColumn>): ServiceColumn {
  return { mode: 'bus', serviceId: '1', tripHeadsign: '', last: null, noService: null, next: null, then: null, later: [], ...over };
}
function vm(columns: ServiceColumn[]): PrioritySplitV2ViewModel {
  return { wallClock: '08:04', date: 'Mon 15 Jun', columns };
}

// ── scenarios ───────────────────────────────────────────────────────────────

// 1. THE dense worst case (split): both columns carry every element at once —
// LAST row + NEXT/THEN heroes + 3 LATER rows + DELAYED/EARLY badges on multiple
// slots, one column with a long headsign to exercise the ellipsis. This is the
// frame the render-fit review must find legible at 960×540, 1-bit.
const denseSplit = vm([
  col({
    mode: 'bus',
    serviceId: '1',
    tripHeadsign: 'ISLAND BAY',
    last: last('RUN', '−1 MIN', 'ARR 08:07', { deviation: 'DELAYED +2 MIN' }),
    next: slot('9 MIN', 'BY 08:13', 'ARR 08:17', { deviation: 'EARLY −1 MIN' }),
    then: slot('19 MIN', 'BY 08:23', 'ARR 08:27', { deviation: 'DELAYED +3 MIN' }),
    later: [later('29 MIN', '08:37', { deviation: 'DELAYED +1 MIN' }), later('39 MIN', '08:47')],
  }),
  col({
    mode: 'train',
    serviceId: 'KPL',
    tripHeadsign: 'WELLINGTON STATION VIA JOHNSONVILLE',
    last: last('MISSED', '−2 MIN', 'ARR 08:10'),
    next: slot('13 MIN', 'BY 08:17', 'ARR 08:25', { deviation: 'DELAYED +4 MIN' }),
    then: slot('28 MIN', 'BY 08:32', 'ARR 08:40', { deviation: 'EARLY −2 MIN' }),
    later: [later('43 MIN', '08:55'), later('58 MIN', '09:10', { deviation: 'DELAYED +2 MIN' })],
  }),
]);

// 2. Normal twin-column morning peak — mockup parity (RUN vs MISSED at once,
// no badges), with LATER_COUNT = 2 rows as shipped.
const normalTwin = vm([
  col({
    mode: 'bus',
    serviceId: '1',
    tripHeadsign: 'ISLAND BAY',
    last: last('RUN', '−1 MIN', 'ARR 08:07'),
    next: slot('9 MIN', 'BY 08:13', 'ARR 08:17'),
    then: slot('19 MIN', 'BY 08:23', 'ARR 08:27'),
    later: [later('29 MIN', '08:37'), later('39 MIN', '08:47')],
  }),
  col({
    mode: 'train',
    serviceId: 'KPL',
    tripHeadsign: 'WELLINGTON STATION',
    last: last('MISSED', '−2 MIN', 'ARR 08:10'),
    next: slot('13 MIN', 'BY 08:17', 'ARR 08:25'),
    then: slot('28 MIN', 'BY 08:32', 'ARR 08:40'),
    later: [later('43 MIN', '08:55'), later('58 MIN', '09:10')],
  }),
]);

// 3. Cancelled-in-hero + no-service. Left column: NEXT cancelled (struck clock,
// no Leave In), the live leave time falling to THEN; LAST also present. Right
// column: no-service state (NO SERVICE in the NEXT band, THEN/LATER suppressed).
const cancelledNoService = vm([
  col({
    mode: 'bus',
    serviceId: '1',
    tripHeadsign: 'ISLAND BAY',
    last: last('MISSED', '−3 MIN', 'ARR 08:05'),
    next: slot('', '', '08:13', { cancelled: true }),
    then: slot('19 MIN', 'BY 08:23', 'ARR 08:27'),
    later: [later('29 MIN', '08:37'), later('', '08:47', { cancelled: true })],
  }),
  col({
    mode: 'train',
    serviceId: 'KPL',
    tripHeadsign: 'WELLINGTON STATION',
    noService: { nextDeparture: '09:45' },
  }),
]);

// 4. Single full-width column, dense — exercises the FULL sizing band (larger
// heroes) with every element present, so its render-fit is judged on its own
// terms, not the split column's.
const denseFull = vm([
  col({
    mode: 'bus',
    serviceId: '1',
    tripHeadsign: 'ISLAND BAY',
    last: last('RUN', '−1 MIN', 'ARR 08:07', { deviation: 'DELAYED +2 MIN' }),
    next: slot('9 MIN', 'BY 08:13', 'ARR 08:17', { deviation: 'EARLY −1 MIN' }),
    then: slot('19 MIN', 'BY 08:23', 'ARR 08:27', { deviation: 'DELAYED +3 MIN' }),
    later: [later('29 MIN', '08:37', { deviation: 'DELAYED +1 MIN' }), later('39 MIN', '08:47')],
  }),
]);

// 5. Any-of mixed-route column — each departure carries its own service-id
// prefix (#107), so a slot reads "NEXT · 635" and rows carry "635 · …". Split
// layout to show the prefix in the tightest space.
const anyOfMixed = vm([
  col({
    mode: 'bus',
    serviceId: '110',
    tripHeadsign: 'PETONE',
    last: last('RUN', '−1 MIN', 'ARR 08:07', { routePrefix: '120' }),
    next: slot('7 MIN', 'BY 08:11', 'ARR 08:18', { routePrefix: '110' }),
    then: slot('14 MIN', 'BY 08:18', 'ARR 08:24', { routePrefix: '130', deviation: 'DELAYED +2 MIN' }),
    later: [later('22 MIN', '08:32', { routePrefix: '110' }), later('29 MIN', '08:39', { routePrefix: '120' })],
  }),
  col({
    mode: 'bus',
    serviceId: '635',
    tripHeadsign: 'SEATOUN',
    last: last('MISSED', '−2 MIN', 'ARR 08:09', { routePrefix: '635' }),
    next: slot('11 MIN', 'BY 08:15', 'ARR 08:22', { routePrefix: '635' }),
    then: slot('21 MIN', 'BY 08:25', 'ARR 08:32', { routePrefix: '650' }),
    later: [later('33 MIN', '08:44', { routePrefix: '635' }), later('44 MIN', '08:55', { routePrefix: '650' })],
  }),
]);

// 6. Badge-overflow worst case (split) — the tightest pane carrying the widest
// possible row: a route prefix AND a 3-digit deviation on the same line
// ("120 · 29 MIN · 08:39  DELAYED +120 MIN"), on NEXT, THEN, and every LATER row
// of a narrow ~480px column. The deviation string is uncapped (#108), so this is
// the realistic maximum width.
//
// KNOWN, ACCEPTED BOUNDARY (reviewed #108): at this pathological 3-digit width
// the widest badge ("DELAYED +nnn MIN") touches the centre divider on the left
// column — it does NOT clip off the panel, and 2-digit deviations (every real
// delay, < ~60 min) clear with a comfortable gutter. We chose not to cap the
// figure or shrink the badge for a near-impossible ≥100-minute deviation. This
// scenario stays as a regression guard: it must keep all content ON the panel —
// a future change that pushes a badge off the frame edge is the real failure.
const badgeOverflow = vm([
  col({
    mode: 'bus',
    serviceId: '120',
    tripHeadsign: 'WAINUIOMATA',
    last: last('MISSED', '−2 MIN', 'ARR 08:09', { routePrefix: '120' }),
    next: slot('7 MIN', 'BY 08:11', 'ARR 08:18', { routePrefix: '120', deviation: 'DELAYED +120 MIN' }),
    then: slot('14 MIN', 'BY 08:18', 'ARR 08:24', { routePrefix: '130', deviation: 'EARLY −120 MIN' }),
    later: [
      later('22 MIN', '08:32', { routePrefix: '120', deviation: 'DELAYED +120 MIN' }),
      later('29 MIN', '08:39', { routePrefix: '130', deviation: 'DELAYED +120 MIN' }),
    ],
  }),
  col({
    mode: 'train',
    serviceId: 'WELL',
    tripHeadsign: 'WELLINGTON',
    last: last('RUN', '−1 MIN', 'ARR 08:07', { routePrefix: 'WELL' }),
    next: slot('11 MIN', 'BY 08:15', 'ARR 08:22', { routePrefix: 'WELL', deviation: 'DELAYED +120 MIN' }),
    then: slot('21 MIN', 'BY 08:25', 'ARR 08:32', { routePrefix: 'KPL', deviation: 'EARLY −120 MIN' }),
    later: [
      later('33 MIN', '08:44', { routePrefix: 'WELL', deviation: 'DELAYED +120 MIN' }),
      later('44 MIN', '08:55', { routePrefix: 'KPL', deviation: 'DELAYED +120 MIN' }),
    ],
  }),
]);

const scenarios: { name: string; vm: PrioritySplitV2ViewModel }[] = [
  { name: '1-dense-split', vm: denseSplit },
  { name: '2-normal-twin', vm: normalTwin },
  { name: '3-cancelled-no-service', vm: cancelledNoService },
  { name: '4-dense-full', vm: denseFull },
  { name: '5-any-of-mixed', vm: anyOfMixed },
  { name: '6-badge-overflow', vm: badgeOverflow },
];

// ── render pipeline (mirrors shared/satori.ts + shared/bmp.ts) ───────────────

async function toSvg(model: PrioritySplitV2ViewModel): Promise<string> {
  return satori(layout(model), {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: FAMILY, data: fontBuffer, weight: 700, style: 'normal' }],
  });
}

function toBmp(svg: string): Uint8Array {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: { fontBuffers: [fontBuffer], defaultFontFamily: FAMILY, loadSystemFonts: false },
  });
  return rgbaTo1BitBmp(r.render().pixels);
}

await initWasm(readFileSync(resvgWasmPath));
mkdirSync(outDir, { recursive: true });

for (const { name, vm: model } of scenarios) {
  const svg = await toSvg(model);
  writeFileSync(join(outDir, `${name}.svg`), svg);
  writeFileSync(join(outDir, `${name}.bmp`), toBmp(svg));
  console.log(`  ✓ ${name}.svg + ${name}.bmp`);
}

console.log(`\nWrote ${scenarios.length} scenarios (svg + 1-bit bmp) to ${outDir}`);
