// BMP renderer for the priority_split layout. Lays out the global header
// (wall-clock) above a single full-width column with five stacked sections —
// column header (mode icon + route code), Tier 1 hero (LEAVE IN), Tier 2
// (BY + ARRIVES), the track + marker, and Tier 3 (NEXT) — per PRD §5.1.
// React/JSX → Satori → resvg → 1-bit BMP, Press Start 2P throughout.

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import { modeIcon } from './mode-icon';
import type { ColumnViewModel, PrioritySplitViewModel } from './viewmodel';

const FAMILY = 'Press Start 2P';
const BLACK = '#000';
const WHITE = '#fff';

const HEADER_H = 44; // ~8% global header
const TRACK_W = 620;
const MARKER = 26;

function column(col: ColumnViewModel, key: number): ReactNode {
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
			{/* Column header — mode icon stacked above route code */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
				}}
			>
				{modeIcon({ mode: col.mode, height: 5 })}
				<div style={{ fontSize: 28, marginTop: 10 }}>{col.routeCode}</div>
			</div>

			{/* Tier 1 — LEAVE IN hero */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
				}}
			>
				<div style={{ fontSize: 22 }}>LEAVE IN</div>
				<div style={{ fontSize: 128, lineHeight: 1, marginTop: 18 }}>
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
				<div style={{ fontSize: 20 }}>{col.leaveBy}</div>
				<div style={{ fontSize: 16, marginTop: 10 }}>{col.arrives}</div>
			</div>

			{/* Track + marker */}
			<div
				style={{
					position: 'relative',
					width: TRACK_W,
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
			<div style={{ fontSize: 18 }}>{col.next}</div>
		</div>
	);
}

function layout(vm: PrioritySplitViewModel): ReactNode {
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

			{/* Content area — one column per transit target (single → full width) */}
			<div style={{ flex: 1, display: 'flex', flexDirection: 'row' }}>
				{vm.columns.map((col, i) => column(col, i))}
			</div>
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
