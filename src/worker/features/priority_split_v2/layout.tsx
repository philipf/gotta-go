// The pure React/JSX tree for priority_split_v2 — everything from per-pane
// sizing down to the full layout, with no rendering side effects. Kept apart
// from view.tsx (which owns the Satori → resvg pipeline and its wasm imports)
// so the exact production tree can be rendered by a standalone harness without
// dragging in the sandbox-only wasm modules (issue #108 render-fit review). The
// view and the harness therefore share this one tree byte-for-byte; there is no
// parallel copy to drift.
//
// Lays out the global header (wall-clock + date) above one or two columns. Each
// column has a header (mode icon + service name) and two **co-equal heroes** —
// the NEXT and THEN slots — split evenly down the column: a combined
// `NEXT · LEAVE IN` caption line, the hero value (or `NOW`), and the qualifying
// `BY hh:mm · ARR hh:mm` line (issue #102). Above the heroes a compact LAST row
// echoes the just-missed service with a RUN/MISSED tag (issue #104); below them
// a compact LATER list shows up to LATER_COUNT further departures as
// `n MIN · hh:mm` rows, or a dash when none follow (issue #103). Two transit
// targets render as equal-width columns split by a vertical hairline rule; a
// single target renders one full-width column with the identical slots.
// DejaVu Sans Bold throughout (ADR-0009).

import type { ReactNode } from 'react';
import { WIDTH, HEIGHT } from '../../shared/bmp';
import { modeIcon, MODE_GRIDS } from './mode-icon';
import { serviceName } from './viewmodel';
import type { DepartureSlot, LastSlot, LaterRow, NoServiceSlot, PrioritySplitV2ViewModel, ServiceColumn } from './viewmodel';

const FAMILY = 'DejaVu Sans';
const BLACK = '#000';
const WHITE = '#fff';
const DASH = '—';

// A cancelled departure's struck scheduled clock — no `CANCELLED` text label,
// the strike-through is the signal (glossary cancelled service, #106).
const STRIKE = { textDecoration: 'line-through' } as const;

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
  lastBandH: number; // fixed height of the LAST band — always reserved (even empty) so the two columns' heroes line up, and its content centres for even spacing (#108 review)
  ruleInset: number; // left/right inset of the internal slot-divider hairlines (#108 review)
  caption: number; // "NEXT" / "THEN" slot caption
  hero: number; // the LEAVE IN value — the headline
  byArr: number; // "BY hh:mm · ARR hh:mm" qualifier
  heroGap: number; // gap between the lines within one hero
  last: number; // the compact LAST row ("RUN  −1 MIN · ARR 08:07")
  lastTag: number; // the RUN / MISSED tag within the LAST row
  deviation: number; // the DELAYED / EARLY badge on any slot (#105)
  noService: number; // the "NO SERVICE" hero value in the no-service state (#106)
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
  lastBandH: 44,
  ruleInset: 80,
  caption: 22,
  // 58, not 68: in a single full-width column the two stacked heroes must share
  // the 496px band with LAST + the merged caption line + the inset slot dividers
  // + a 3-row LATER list. 58 is the largest that clears the BY · ARR line below
  // in the dense worst case (issue #108 render-fit); width, not height, is what
  // makes the full-width column read big.
  hero: 58,
  byArr: 26,
  heroGap: 4,
  last: 24,
  lastTag: 18,
  deviation: 18,
  noService: 52,
  laterCaption: 22,
  laterRow: 24,
  laterGap: 2,
};

const SPLIT: Sizing = {
  modeIconH: 4,
  routeLabel: 28,
  labelMaxW: 400,
  lastBandH: 38,
  ruleInset: 40,
  caption: 22,
  hero: 64,
  byArr: 24,
  heroGap: 6,
  last: 20,
  lastTag: 15,
  deviation: 15,
  noService: 44,
  laterCaption: 20,
  laterRow: 22,
  laterGap: 4,
};

const MAX_ICON_ROWS = Math.max(...Object.values(MODE_GRIDS).map((g) => g.length));

// A schedule-deviation badge — the bordered DELAYED / EARLY label rendered on
// whichever slot the affected departure occupies (#105). Density across the
// LATER + LAST stack is provisional here; the render-fit review slice tunes the
// exact sizing/wrapping (priority_split_v2_delta §6).
function badge(text: string, size: number): ReactNode {
  return (
    <div key="badge" style={{ fontSize: size, border: `2px solid ${BLACK}`, padding: '1px 6px', lineHeight: 1 }}>
      {text}
    </div>
  );
}

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

// The flex-grow wrapper that makes the two heroes split the column's height
// evenly — co-equal, not primary/secondary. The NO SERVICE block reuses it so
// it occupies the same band a NEXT hero would.
function heroFrame(children: ReactNode, s: Sizing): ReactNode {
  return (
    <div
      style={{
        // flexGrow/flexBasis, not the `flex: 1` shorthand — Satori does not
        // expand the shorthand's grow, so `flex: 1` left both heroes at zero
        // height, overlapping at the column top (issue #108). flexBasis 0 makes
        // the two heroes co-equal: they split the column's free height evenly.
        flexGrow: 1,
        flexBasis: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.heroGap,
      }}
    >
      {children}
    </div>
  );
}

// The slot caption, suffixed with the departure's own service id for an any-of
// target so mixed routes under one column header stay distinguishable — e.g.
// "NEXT · 635" (#107). Bare "NEXT" for a single-route target (routePrefix '') or
// an absent slot.
function slotCaption(caption: string, slot: DepartureSlot | null): string {
  return slot?.routePrefix ? `${caption} · ${slot.routePrefix}` : caption;
}

// The hero value with its unit at half size — "9 MIN" renders the 9 at full
// hero size and MIN at hero/2, pulling the eye to the minute count (matches the
// spec, #108). "NOW" and the dash carry no unit and render whole.
function heroValue(text: string, s: Sizing): ReactNode {
  const m = /^(.*\S)\s+MIN$/.exec(text);
  if (!m)
    return (
      <div key="val" style={{ fontSize: s.hero, lineHeight: 1 }}>
        {text}
      </div>
    );
  return (
    <div
      key="val"
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, lineHeight: 1 }}
    >
      <span style={{ fontSize: s.hero }}>{m[1]}</span>
      <span style={{ fontSize: Math.round(s.hero / 2) }}>MIN</span>
    </div>
  );
}

// One co-equal hero: the slot caption (NEXT / THEN), the LEAVE IN label, the
// hero value (or NOW), and the BY · ARR qualifier. An absent slot dashes the
// value and qualifier so the column keeps a stable two-hero shape rather than
// collapsing. A cancelled departure keeps its slot but shows only its struck
// scheduled clock in the hero value area — the LEAVE IN label and qualifier are
// suppressed, and the real leave-time number falls to the next live hero below
// (#106).
function hero(caption: string, slot: DepartureSlot | null, s: Sizing): ReactNode {
  // Children are passed as an array, not a Fragment: Satori wraps a Fragment's
  // children in an implicit default-row container, which laid the caption, label,
  // hero value and qualifier out side-by-side instead of stacked (issue #108).
  if (slot?.cancelled) {
    return heroFrame(
      [
        <div key="cap" style={{ fontSize: s.caption }}>
          {slotCaption(caption, slot)}
        </div>,
        <div key="val" style={{ fontSize: s.hero, lineHeight: 1, ...STRIKE }}>
          {slot.arrives}
        </div>,
      ],
      s,
    );
  }
  return heroFrame(
    [
      // Caption and LEAVE IN share one line — "NEXT · LEAVE IN" — per the spec
      // (#108); merging them also frees a vertical line for the hero value.
      <div key="cap" style={{ fontSize: s.caption }}>
        {`${slotCaption(caption, slot)} · LEAVE IN`}
      </div>,
      heroValue(slot ? slot.leaveIn : DASH, s),
      // The deviation badge sits inline to the right of the BY · ARR qualifier,
      // not on its own stacked line: a stacked badge pushed the hero content past
      // its band and the big value collided with the qualifier (issue #108).
      // alignItems baseline so the badge text sits on the BY · ARR baseline
      // rather than centring the (shorter) badge box against the line (#108).
      <div
        key="qual"
        style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, fontSize: s.byArr }}
      >
        <span>{slot ? `${slot.leaveBy} · ${slot.arrives}` : DASH}</span>
        {slot?.deviation ? badge(slot.deviation, s.deviation) : null}
      </div>,
    ],
    s,
  );
}

// The no-service block in the NEXT band: the literal `NO SERVICE` with the next
// available departure clock below it (or a dash when the feed has none). THEN
// and LATER are suppressed by the caller, so this block stands alone (#106).
function noServiceHero(slot: NoServiceSlot, s: Sizing): ReactNode {
  return heroFrame(
    [
      <div key="cap" style={{ fontSize: s.caption }}>
        NEXT
      </div>,
      <div key="val" style={{ fontSize: s.noService, lineHeight: 1 }}>
        NO SERVICE
      </div>,
      <div key="next" style={{ fontSize: s.byArr }}>
        {slot.nextDeparture ? `NEXT ${slot.nextDeparture}` : DASH}
      </div>,
    ],
    s,
  );
}

// The compact LAST row (#104): the RUN/MISSED tag followed by the negative
// Leave In and the still-future arrival clock, on one line above the NEXT hero
// — "RUN  −1 MIN · ARR 08:07". Rendered only while a just-missed service is in
// the window; the row is omitted (null) once the service reaches the stop, so
// the column simply opens with NEXT and nothing reserves the space.
function lastRow(slot: LastSlot, s: Sizing): ReactNode {
  // A cancelled just-missed service shows only its struck scheduled clock — no
  // RUN/MISSED tag, it was never catchable (#106).
  if (slot.cancelled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 10, fontSize: s.last }}>
        {slot.routePrefix ? <span>{slot.routePrefix}</span> : null}
        <span style={STRIKE}>{slot.arrives}</span>
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'center',
        gap: 10,
        fontSize: s.last,
      }}
    >
      <span style={{ fontSize: s.lastTag, letterSpacing: 2 }}>{slot.tag}</span>
      <span>{slot.routePrefix ? `${slot.routePrefix} · ${slot.leaveIn} · ${slot.arrives}` : `${slot.leaveIn} · ${slot.arrives}`}</span>
      {slot.deviation ? badge(slot.deviation, s.deviation) : null}
    </div>
  );
}

// The LAST band: a fixed-height slot that always reserves space (even when there
// is no just-missed service) so the NEXT heroes line up across the two columns,
// and centres its content so the just-missed line has even space above and below
// (#108 review). Empty when there is no just-missed service in the window.
function lastBand(slot: LastSlot | null, s: Sizing): ReactNode {
  return (
    <div style={{ height: s.lastBandH, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center' }}>
      {slot ? lastRow(slot, s) : null}
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
        rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, fontSize: s.laterRow }}>
            {row.cancelled ? (
              // A cancelled LATER departure shows only its struck scheduled clock,
              // kept distinguishable by its bare route prefix for any-of targets (#106/#107).
              <>
                {row.routePrefix ? <span>{row.routePrefix} · </span> : null}
                <span style={STRIKE}>{row.arrives}</span>
              </>
            ) : (
              <>
                <span>{row.routePrefix ? `${row.routePrefix} · ${row.leaveIn} · ${row.arrives}` : `${row.leaveIn} · ${row.arrives}`}</span>
                {row.deviation ? badge(row.deviation, s.deviation) : null}
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function column(col: ServiceColumn, key: number, s: Sizing): ReactNode {
  return (
    <div
      key={key}
      style={{
        // flexGrow + flexBasis 0 makes the two columns share the width evenly
        // (the `flex: 1` shorthand's grow is not honoured by Satori — #108).
        flexGrow: 1,
        flexBasis: 0,
        display: 'flex',
        flexDirection: 'column',
        // stretch, not center: each child fills the column width and centres its
        // own content internally. Centring here instead shrinks every child to
        // its min-content width, which makes Satori wrap the large hero value
        // into a one-character-wide vertical sliver (issue #108 render-fit).
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        padding: '14px 0 18px',
      }}
    >
      {/* Each slot is a separate child expression, not wrapped in a Fragment:
          Satori treats a Fragment as an implicit default-row container, which
          laid the two heroes and the LATER list out side-by-side across the
          column instead of stacked (issue #108). Nulls are skipped by Satori.
          Inset hairlines (hRule) separate the slot bands, matching the spec. */}
      {header(col, s)}
      {/* The LAST band and its divider are always rendered — empty when there is
          no just-missed service — so both columns' heroes stay aligned (#108). */}
      {lastBand(col.last, s)}
      {hRule('r-last', s)}
      {/* No-service state: NO SERVICE in the NEXT band, THEN / LATER suppressed (#106). */}
      {col.noService ? noServiceHero(col.noService, s) : null}
      {col.noService ? null : hero('NEXT', col.next, s)}
      {col.noService ? null : hRule('r-next', s)}
      {col.noService ? null : hero('THEN', col.then, s)}
      {col.noService ? null : hRule('r-then', s)}
      {col.noService ? null : laterList(col.later, s)}
    </div>
  );
}

// A full-height vertical hairline rule separating two columns.
function rule(key: number): ReactNode {
  return <div key={key} style={{ width: RULE_W, alignSelf: 'stretch', backgroundColor: BLACK }} />;
}

// A horizontal hairline separating two slot bands within a column (LAST | NEXT |
// THEN | LATER), inset from the column edges so it reads as a divider, not a
// full-width border (matches the original spec, #108 review).
function hRule(key: string, s: Sizing): ReactNode {
  return <div key={key} style={{ height: RULE_W, backgroundColor: BLACK, marginLeft: s.ruleInset, marginRight: s.ruleInset }} />;
}

// The full priority_split_v2 frame tree for a view model — the exact JSX both
// the production view (renderSvg/renderBmp) and the render-fit harness feed to
// Satori.
export function layout(vm: PrioritySplitV2ViewModel): ReactNode {
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
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'row' }}>{panes}</div>
    </div>
  );
}
