// View renderer for the dual_month_calendar layout. Lays out the current-date
// header above two Monday-start month grids (this month left, next month
// right) as React/JSX and renders it via Satori → resvg, exposing both the
// intermediate SVG (ADR-0004 diagnostics) and the rasterised 1-bit BMP, using
// DejaVu Sans Bold (ADR-0009). Today's cell is inverted (solid black, white
// number); weekends stay plain — the panel is 1-bit, so gencal-style grey
// shading does not exist (#75).

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import type { MonthGrid, ViewModel } from './viewmodel';

// Folded into the weak ETag (ADR-0013). Bump whenever this file changes the
// rendered appearance without changing the view model — sizing, spacing,
// styling — so radiators holding a matching ETag redraw on their next wake.
export const LAYOUT_VERSION = 2;

const FAMILY = 'DejaVu Sans';
const BLACK = '#000';
const WHITE = '#fff';

// Sizing for 960×540: two 7-column grids (7 × CELL_W = 392 each) plus the gap
// come to 848, leaving symmetric margins; header + caption + weekday row +
// up to 6 week rows clear the height. Exact cell styling is tune-on-the-panel —
// verify live per ADR-0009.
const HEADER_SIZE = 42;
const CAPTION_SIZE = 34;
const DOW_SIZE = 24;
const DAY_SIZE = 28;
// Cells grow with the font (panel-read tuning) so the per-cell whitespace
// ratio stays as tuned at v1; 7 × 60 × 2 grids + the gap = 904 < 960.
const CELL_W = 60;
const CELL_H = 48;
const GRID_GAP = 64;

const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function cell(content: string, inverted: boolean, fontSize: number, key: number): ReactNode {
	return (
		<div
			key={key}
			style={{
				width: CELL_W,
				height: CELL_H,
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				fontSize,
				backgroundColor: inverted ? BLACK : WHITE,
				color: inverted ? WHITE : BLACK,
			}}
		>
			{content}
		</div>
	);
}

function grid(month: MonthGrid): ReactNode {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
			<div style={{ fontSize: CAPTION_SIZE, marginBottom: 14 }}>{month.caption}</div>
			<div style={{ display: 'flex' }}>
				{DOW_LABELS.map((label, i) => cell(label, false, DOW_SIZE, i))}
			</div>
			{month.weeks.map((week, w) => (
				<div key={w} style={{ display: 'flex' }}>
					{/* Guard the null blanks: in the next-month grid `today` is null
					    too, and `null === null` would invert every blank cell. */}
					{week.map((day, i) =>
						cell(day === null ? '' : String(day), day !== null && day === month.today, DAY_SIZE, i),
					)}
				</div>
			))}
		</div>
	);
}

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
				alignItems: 'center',
				// Top-anchored, not justify-centered: centring leaves ~70px above
				// the header vs ~30px below it (the band looks sunk). 30px up top
				// balances the header band; spare height falls to the bottom, where
				// a 6-week month's extra row consumes it.
				paddingTop: 30,
				fontFamily: FAMILY,
				fontWeight: 700,
			}}
		>
			<div style={{ fontSize: HEADER_SIZE, lineHeight: 1 }}>{vm.header}</div>
			{/* The grid block (captions + weekday names + cells) centres in the
			    height left under the header, so a 5-week month splits the spare
			    space evenly instead of pooling it at the bottom; a 6-week month
			    just centres tighter. The inner row top-aligns the two grids with
			    each other — when their week counts differ, centring each grid
			    individually would stagger the captions. */}
			<div style={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
				<div style={{ display: 'flex', alignItems: 'flex-start' }}>
					<div style={{ display: 'flex', marginRight: GRID_GAP }}>{grid(vm.months[0])}</div>
					<div style={{ display: 'flex' }}>{grid(vm.months[1])}</div>
				</div>
			</div>
		</div>
	);
}

// The intermediate Satori SVG for this view model. The diagnostics SVG variant
// (ADR-0004) returns it verbatim, and renderBmp rasterises this exact string —
// one render path, so the SVG a human inspects is byte-for-byte the input the
// BMP encoder saw.
export function renderSvg(vm: ViewModel): Promise<string> {
	return jsxToSvg(layout(vm));
}

export async function renderBmp(vm: ViewModel): Promise<Uint8Array> {
	const svg = await renderSvg(vm);
	const rgba = await svgToRgba(svg);
	return rgbaTo1BitBmp(rgba);
}
