// View renderer for priority_split_v2. Lays out the global header (wall-clock +
// date) above one or two columns. Each column has a header (mode icon + service
// name) and two **co-equal heroes** — the NEXT and THEN slots — split evenly
// down the column: a slot caption, the `LEAVE IN` label, the hero value (or
// `NOW`), and the qualifying `BY hh:mm · ARR hh:mm` line (issue #102). Below the
// heroes a compact LATER list shows up to LATER_COUNT further departures as
// `n MIN · hh:mm` rows, or a dash when none follow (issue #103). Two transit
// targets render as equal-width columns split by a vertical hairline rule; a
// single target renders one full-width column with the identical slots.
// React/JSX → Satori → resvg, exposing the intermediate SVG (ADR-0004) and the
// rasterised 1-bit BMP, DejaVu Sans Bold throughout (ADR-0009).

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import { modeIcon, MODE_GRIDS } from './mode-icon';
import { serviceName } from './viewmodel';
import type { DepartureSlot, LaterRow, PrioritySplitV2ViewModel, ServiceColumn } from './viewmodel';

// Folded into the weak ETag (ADR-0013). Bump whenever this file changes the
// rendered appearance without changing the view model — sizing, spacing,
// styling — so radiators holding a matching ETag redraw on their next wake.
export const LAYOUT_VERSION = 2;

const FAMILY = 'DejaVu Sans';
const BLACK = '#000';
const WHITE = '#fff';
const DASH = '—';

const HEADER_H = 44; // ~8% global header
const RULE_W = 2; // hairline rule between two columns — matches the header border

// Per-pane sizing. A single full-width column (960px) carries large heroes; a
// half-width column (~480px) scales the type down so two stacked heroes fit
// without overflow. Two co-equal heroes share the vertical space, so each hero
// value is necessarily smaller than v1's single full-height hero. Sizes are a
// first pass for the walking skeleton — live-tune against `wrangler dev` per
// ADR-0009 before they are load-bearing.
type Sizing = {
  modeIconH: number;
  routeLabel: number; // service-name label (service_id · trip_headsign) font size
  labelMaxW: number; // cap so a long headsign truncates with an ellipsis, not overflow
  caption: number; // "NEXT" / "THEN" slot caption
  leaveInLabel: number;
  hero: number; // the LEAVE IN value — the headline
  byArr: number; // "BY hh:mm · ARR hh:mm" qualifier
  heroGap: number; // gap between the lines within one hero
  laterCaption: number; // "LATER" caption above the compact list
  laterRow: number; // a compact "n MIN · hh:mm" LATER row
  laterGap: number; // gap between LATER rows
};

// A single full-width column has the same 540px height as a split pane, so it
// cannot afford a much taller hero once the LATER list claims the lower third —
// the two co-equal heroes and the 3-row LATER block must share the column height
// (issue #103 render-fit). The hero is only modestly larger than SPLIT's; the
// width, not the height, is what makes the full-width column read bigger.
const FULL: Sizing = {
  modeIconH: 4,
  routeLabel: 30,
  labelMaxW: 820,
  caption: 22,
  leaveInLabel: 22,
  hero: 68,
  byArr: 26,
  heroGap: 2,
  laterCaption: 22,
  laterRow: 24,
  laterGap: 2,
};

const SPLIT: Sizing = {
  modeIconH: 4,
  routeLabel: 28,
  labelMaxW: 400,
  caption: 22,
  leaveInLabel: 22,
  hero: 64,
  byArr: 24,
  heroGap: 6,
  laterCaption: 20,
  laterRow: 22,
  laterGap: 4,
};

const MAX_ICON_ROWS = Math.max(...Object.values(MODE_GRIDS).map((g) => g.length));

// Column header — mode icon on the left, service name to its right
// (service_id · trip_headsign). A long headsign truncates with an ellipsis
// inside the narrow split pane so every column keeps the same single-line
// header height.
function header(col: ServiceColumn, s: Sizing): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        height: MAX_ICON_ROWS * s.modeIconH,
      }}
    >
      {modeIcon({ mode: col.mode, height: s.modeIconH })}
      <div
        style={{
          fontSize: s.routeLabel,
          maxWidth: s.labelMaxW,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {serviceName(col.serviceId, col.tripHeadsign)}
      </div>
    </div>
  );
}

// One co-equal hero: the slot caption (NEXT / THEN), the LEAVE IN label, the
// hero value (or NOW), and the BY · ARR qualifier. An absent slot dashes the
// value and qualifier so the column keeps a stable two-hero shape rather than
// collapsing. The flex-grow wrapper makes the two heroes split the column's
// height evenly — co-equal, not primary/secondary.
function hero(caption: string, slot: DepartureSlot | null, s: Sizing): ReactNode {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.heroGap,
      }}
    >
      <div style={{ fontSize: s.caption }}>{caption}</div>
      <div style={{ fontSize: s.leaveInLabel }}>LEAVE IN</div>
      <div style={{ fontSize: s.hero, lineHeight: 1 }}>{slot ? slot.leaveIn : DASH}</div>
      <div style={{ fontSize: s.byArr }}>{slot ? `${slot.leaveBy} · ${slot.arrives}` : DASH}</div>
    </div>
  );
}

// The compact LATER list below the two heroes: a caption over up to LATER_COUNT
// `n MIN · hh:mm` rows. An empty list dashes the section so the column keeps a
// stable shape rather than the heroes sliding down to fill the gap.
function laterList(rows: LaterRow[], s: Sizing): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: s.laterGap,
        paddingTop: 8,
      }}
    >
      <div style={{ fontSize: s.laterCaption }}>LATER</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: s.laterRow }}>{DASH}</div>
      ) : (
        rows.map((row, i) => <div key={i} style={{ fontSize: s.laterRow }}>{`${row.leaveIn} · ${row.arrives}`}</div>)
      )}
    </div>
  );
}

function column(col: ServiceColumn, key: number, s: Sizing): ReactNode {
  return (
    <div
      key={key}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '24px 0',
      }}
    >
      {header(col, s)}
      {hero('NEXT', col.next, s)}
      {hero('THEN', col.then, s)}
      {laterList(col.later, s)}
    </div>
  );
}

// A full-height vertical hairline rule separating two columns.
function rule(key: number): ReactNode {
  return <div key={key} style={{ width: RULE_W, alignSelf: 'stretch', backgroundColor: BLACK }} />;
}

function layout(vm: PrioritySplitV2ViewModel): ReactNode {
  const sizing = vm.columns.length > 1 ? SPLIT : FULL;

  // Interleave the columns with hairline rules: [col, rule, col, …]. A single
  // column yields no rule and auto-scales to the full content width.
  const panes: ReactNode[] = [];
  vm.columns.forEach((col, i) => {
    if (i > 0) panes.push(rule(-i));
    panes.push(column(col, i, sizing));
  });

  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: WHITE,
        color: BLACK,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FAMILY,
        fontWeight: 700,
      }}
    >
      {/* Global header — wall-clock + date across the full width. The date
          confirms the frame refreshed rather than holding a stale overnight
          frame (#46); it sits to the right so the time keeps its centre. */}
      <div
        style={{
          height: HEADER_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: `2px solid ${BLACK}`,
          fontSize: 26,
        }}
      >
        <span>{vm.wallClock}</span>
        <span style={{ marginLeft: 16 }}>{vm.date}</span>
      </div>

      {/* Content area — one or two columns split by a hairline rule */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row' }}>{panes}</div>
    </div>
  );
}

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
