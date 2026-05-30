// BMP renderer for the priority_split layout. Lays out the global header
// (wall-clock) above one or two columns, each with five stacked sections —
// column header (mode icon + service name), Tier 1 hero (LEAVE IN), Tier 2
// (BY + ARRIVES), the track + marker, and Tier 3 (NEXT) — per PRD §5.1. Two
// transit targets render as equal-width columns split by a vertical hairline
// rule (#6); the type scales down so the hero + track fit the half-width pane.
// React/JSX → Satori → resvg → 1-bit BMP, DejaVu Sans Bold throughout (ADR-0009).

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import { modeIcon } from './mode-icon';
import { serviceName } from './service-name';
import type { ColumnViewModel, PrioritySplitViewModel } from './viewmodel';

const FAMILY = 'DejaVu Sans';
const BLACK = '#000';
const WHITE = '#fff';

const HEADER_H = 44; // ~8% global header
const MARKER = 26;
const RULE_W = 2; // hairline rule between two columns — matches the header border

// Per-pane sizing. A single full-width column (960px) carries the large hero
// and a wide fixed track; a half-width column (~480px) scales both down so the
// content fits without overflow. `trackW` is a percentage in the split case so
// it tracks whatever width the flex pane resolves to.
//
// Sizes are tuned for DejaVu Sans Bold's proportional metric (ADR-0009), which
// reclaimed ~40% horizontal width over the old mono font. Small-tier sizes
// honour the minimum-legible-1-bit floor (FLOOR_PX): below it, DejaVu's
// anti-aliasing thresholds to a ragged glyph on the panel. The floor is
// provisional pending the live `wrangler dev` read called for in ADR-0009.
const FLOOR_PX = 15;

type Sizing = {
	modeIconH: number;
	routeLabel: number; // service-name label (service_id · trip_headsign) font size
	labelMaxW: number; // cap so a long headsign truncates with an ellipsis, not overflow
	leaveInLabel: number;
	hero: number;
	leaveBy: number;
	arrives: number;
	next: number;
	trackW: number | string;
	rowGap: number; // fixed gap between the column's five sections
	heroGap: number; // gap within the LEAVE IN hero group (label ↔ value ↔ BY)
};

const FULL: Sizing = {
	modeIconH: 5,
	routeLabel: 30, // service name, bumped +15% over `arrives` (live-tuned)
	labelMaxW: 820, // wide enough that a full-width column never truncates in practice
	leaveInLabel: 26, // matched to `arrives` (live-tuned)
	hero: 128, // full pane never had the #42 overflow; the proportional metric only adds headroom
	leaveBy: 32, // Tier 2/3 grown into the ample vertical whitespace (live-tuned)
	arrives: 26,
	next: 29,
	trackW: 620,
	rowGap: 13, // gap between the five sections (live-tuned)
	heroGap: 8, // tight LEAVE IN ↔ hero ↔ BY grouping (live-tuned)
};

const SPLIT: Sizing = {
	modeIconH: 4,
	routeLabel: 28, // service name, bumped +15% over `arrives` (live-tuned)
	labelMaxW: 400, // half-width pane: proportional text fits "KPL · Wellington Station"; longer names ellipsize
	leaveInLabel: 24, // matched to `arrives` (live-tuned)
	// Proportional digits/caps make the widest valid hero ("NN MIN") ~60% of its
	// old mono width, so the #42 emergency shrink to 64 is no longer needed: 96
	// refills the half-pane (~479px wide) without touching the centre rule, while
	// staying under the vertically-proven FULL hero (128). Verify live per ADR-0009.
	hero: 96,
	leaveBy: 27, // Tier 2/3 grown into the ample vertical whitespace (live-tuned)
	arrives: 24,
	next: 24,
	trackW: '88%',
	rowGap: 18, // gap between the five sections (live-tuned)
	heroGap: 8, // tight LEAVE IN ↔ hero ↔ BY grouping (live-tuned)
};

function column(col: ColumnViewModel, key: number, s: Sizing): ReactNode {
	return (
		<div
			key={key}
			style={{
				flex: 1,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				// Top-anchored stack with a fixed gap rather than space-between:
				// the header pins under the global wall-clock (as before) and the
				// sections sit close together. NEXT lives in a flex-grow wrapper
				// (below) that centres it in the leftover space; the bottom padding
				// equals rowGap so NEXT's gap to the track and to the screen edge
				// come out symmetric.
				justifyContent: 'flex-start',
				gap: s.rowGap,
				padding: `24px 0 ${s.rowGap}px`,
			}}
		>
			{/* Column header — mode icon on the left, service name to its right
			    (service_id·trip_headsign). A long headsign truncates with an
			    ellipsis inside the narrow split pane so every column keeps the
			    same single-line header height (#40). */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 12,
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

			{/* Tier 1 — the LEAVE IN hero group: the LEAVE IN label, the hero
			    value, and the BY hh:mm that qualifies it. BY belongs to the hero
			    (it answers "leave by when?"), not to the ARRIVES detail, so it
			    sits below the hero with the same gap LEAVE IN has above it. The
			    extra top margin stacks on rowGap to push the group 2.5× rowGap
			    clear of the header, giving the hero room to breathe. */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					marginTop: s.rowGap * 1.5,
				}}
			>
				<div style={{ fontSize: s.leaveInLabel }}>LEAVE IN</div>
				<div style={{ fontSize: s.hero, lineHeight: 1, marginTop: s.heroGap }}>
					{col.leaveIn}
				</div>
				<div style={{ fontSize: s.leaveBy, marginTop: s.heroGap }}>
					{col.leaveBy}
				</div>
			</div>

			{/* Tier 2 — ARRIVES n MIN · hh:mm. Extra top margin sets it apart
			    from the hero group (whose last line is BY), reinforcing that
			    ARRIVES is supporting detail, not part of the hero. */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					marginTop: 12,
				}}
			>
				<div style={{ fontSize: s.arrives }}>{col.arrives}</div>
			</div>

			{/* Track + marker */}
			<div
				style={{
					position: 'relative',
					width: s.trackW,
					height: MARKER + 8,
					display: 'flex',
					alignItems: 'center',
				}}
			>
				<div style={{ width: '100%', height: 4, backgroundColor: BLACK }} />
				<div
					style={{
						position: 'absolute',
						left: `${col.markerRatio * 100}%`,
						width: MARKER,
						height: MARKER,
						backgroundColor: BLACK,
						transform: 'translateX(-50%) rotate(45deg)',
					}}
				/>
			</div>

			{/* Tier 3 — NEXT. Wrapped in a flex-grow box that centres it in the
			    leftover space below the track, so its gap to the track equals its
			    gap to the screen edge (which is the rowGap bottom padding). */}
			<div
				style={{
					flex: 1,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<div style={{ fontSize: s.next }}>{col.next}</div>
			</div>
		</div>
	);
}

// A full-height vertical hairline rule separating two columns (PRD §5.1).
function rule(key: number): ReactNode {
	return (
		<div
			key={key}
			style={{ width: RULE_W, alignSelf: 'stretch', backgroundColor: BLACK }}
		/>
	);
}

function layout(vm: PrioritySplitViewModel): ReactNode {
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
			{/* Global header — wall-clock across the full width */}
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
				{vm.wallClock}
			</div>

			{/* Content area — one or two columns split by a hairline rule (#6) */}
			<div style={{ flex: 1, display: 'flex', flexDirection: 'row' }}>{panes}</div>
		</div>
	);
}

// The intermediate Satori SVG for this view model. The diagnostics SVG variant
// (#20 / ADR-0004) returns it verbatim, and renderBmp rasterises this exact
// string — one render path, so the SVG a human inspects is byte-for-byte the
// input the BMP encoder saw.
export function renderSvg(vm: PrioritySplitViewModel): Promise<string> {
	return jsxToSvg(layout(vm));
}

export async function renderBmp(vm: PrioritySplitViewModel): Promise<Uint8Array> {
	const svg = await renderSvg(vm);
	const rgba = await svgToRgba(svg);
	return rgbaTo1BitBmp(rgba);
}
