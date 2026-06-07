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
export const LAYOUT_VERSION = 1;

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

// Hairline cell grid: every cell owns its top+left edge and the last
// column/row close the rectangle, so adjacent cells share one 1px line
// instead of doubling up to 2px.
const BORDER = `1px solid ${BLACK}`;

// Weekend "grey" on a 1-bit panel: an ordered-dither illusion — a tiled 2×2
// vector checkerboard (one black pixel per tile = 25% density) as the cell's
// background image. Crucially this stays in Satori land: the dots are real
// black pixels at raster time, so they pass the bmp.ts luma-128 threshold
// untouched; a CSS grey backgroundColor would collapse to solid white there.
const SHADE_TILE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'%3E%3Crect width='1' height='1' fill='black'/%3E%3C/svg%3E";

type CellOpts = {
	inverted: boolean; // today: solid black cell, white number (wins over shaded)
	shaded: boolean; // weekend column: dithered-grey background
	fontSize: number;
	lastCol: boolean;
	lastRow: boolean;
};

function cell(content: string, key: number, opts: CellOpts): ReactNode {
	return (
		<div
			key={key}
			style={{
				width: CELL_W,
				height: CELL_H,
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				fontSize: opts.fontSize,
				backgroundColor: opts.inverted ? BLACK : WHITE,
				color: opts.inverted ? WHITE : BLACK,
				borderTop: BORDER,
				borderLeft: BORDER,
				// Spread, not `border*: undefined` — Satori trims border strings
				// and throws on an undefined value.
				...(opts.lastCol ? { borderRight: BORDER } : {}),
				...(opts.lastRow ? { borderBottom: BORDER } : {}),
				...(opts.shaded && !opts.inverted
					? { backgroundImage: `url("${SHADE_TILE}")`, backgroundSize: '2px 2px' }
					: {}),
			}}
		>
			{content}
		</div>
	);
}

// Monday-start columns 5 and 6 are Sa/Su.
const isWeekendCol = (i: number): boolean => i >= 5;

function grid(month: MonthGrid): ReactNode {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
			<div style={{ fontSize: CAPTION_SIZE, marginBottom: 14 }}>{month.caption}</div>
			<div style={{ display: 'flex' }}>
				{DOW_LABELS.map((label, i) =>
					cell(label, i, {
						inverted: false,
						shaded: isWeekendCol(i),
						fontSize: DOW_SIZE,
						lastCol: i === 6,
						lastRow: false,
					}),
				)}
			</div>
			{month.weeks.map((week, w) => (
				<div key={w} style={{ display: 'flex' }}>
					{/* Guard the null blanks: in the next-month grid `today` is null
					    too, and `null === null` would invert every blank cell. */}
					{week.map((day, i) =>
						cell(day === null ? '' : String(day), i, {
							inverted: day !== null && day === month.today,
							shaded: isWeekendCol(i),
							fontSize: DAY_SIZE,
							lastCol: i === 6,
							lastRow: w === month.weeks.length - 1,
						}),
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
