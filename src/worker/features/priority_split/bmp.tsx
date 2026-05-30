// BMP renderer for the priority_split layout. Lays out the global header
// (wall-clock) above one or two columns, each with five stacked sections —
// column header (mode icon + service name), Tier 1 hero (LEAVE IN), Tier 2
// (BY + ARRIVES), the track + marker, and Tier 3 (NEXT) — per PRD §5.1. Two
// transit targets render as equal-width columns split by a vertical hairline
// rule (#6); the type scales down so the hero + track fit the half-width pane.
// React/JSX → Satori → resvg → 1-bit BMP, Press Start 2P throughout.

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import { modeIcon } from './mode-icon';
import { serviceName } from './service-name';
import type { ColumnViewModel, PrioritySplitViewModel } from './viewmodel';

const FAMILY = 'Press Start 2P';
const BLACK = '#000';
const WHITE = '#fff';

const HEADER_H = 44; // ~8% global header
const MARKER = 26;
const RULE_W = 2; // hairline rule between two columns — matches the header border

// Per-pane sizing. A single full-width column (960px) carries the large hero
// and a wide fixed track; a half-width column (~480px) scales both down so the
// content fits without overflow. `trackW` is a percentage in the split case so
// it tracks whatever width the flex pane resolves to.
type Sizing = {
	modeIconH: number;
	routeLabel: number; // service-name label (service_id·trip_headsign) font size
	labelMaxW: number; // cap so a long headsign truncates with an ellipsis, not overflow
	leaveInLabel: number;
	hero: number;
	leaveBy: number;
	arrives: number;
	next: number;
	trackW: number | string;
};

const FULL: Sizing = {
	modeIconH: 5,
	routeLabel: 28,
	labelMaxW: 820, // wide enough that a full-width column never truncates in practice
	leaveInLabel: 22,
	hero: 128,
	leaveBy: 20,
	arrives: 16,
	next: 18,
	trackW: 620,
};

const SPLIT: Sizing = {
	modeIconH: 4,
	routeLabel: 22,
	labelMaxW: 380, // half-width pane: truncate long headsigns rather than overflow the rule
	leaveInLabel: 18,
	hero: 76,
	leaveBy: 16,
	arrives: 13,
	next: 15,
	trackW: '88%',
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
				justifyContent: 'space-between',
				padding: '24px 0 28px',
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

			{/* Tier 1 — LEAVE IN hero */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
				}}
			>
				<div style={{ fontSize: s.leaveInLabel }}>LEAVE IN</div>
				<div style={{ fontSize: s.hero, lineHeight: 1, marginTop: 18 }}>
					{col.leaveIn}
				</div>
			</div>

			{/* Tier 2 — BY hh:mm over ARRIVES n MIN · hh:mm */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
				}}
			>
				<div style={{ fontSize: s.leaveBy }}>{col.leaveBy}</div>
				<div style={{ fontSize: s.arrives, marginTop: 10 }}>{col.arrives}</div>
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

			{/* Tier 3 — NEXT */}
			<div style={{ fontSize: s.next }}>{col.next}</div>
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
