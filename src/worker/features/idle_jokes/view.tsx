// View renderer for the idle_jokes layout. Lays out the bundled meme on the
// left (~30%) and the joke on the right (~70%) as React/JSX, separated by a
// vertical splitter rule hugging the joke's left edge, and renders it via
// Satori → resvg — exposing both the intermediate SVG (ADR-0004 diagnostics)
// and the rasterised 1-bit BMP. DejaVu Sans Bold (ADR-0009); no wall-clock by
// design (#17) so nothing on the frame can go stale across the long idle sleep.

import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp';
import memePng from '../../assets/yao-ming.png';
import type { ViewModel } from './viewmodel';

const FAMILY = 'DejaVu Sans';
const BLACK = '#000';
const WHITE = '#fff';

// The meme is a 1-bit asset; embed it once per isolate as a base64 data URI so
// Satori inlines it as an <image> and resvg rasterises it with everything else.
function toDataUri(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return `data:image/png;base64,${btoa(binary)}`;
}

const MEME_SRC = toDataUri(memePng);

// Meme column is a fixed 30% of the frame (on the right); the image is sized to
// fit *inside* it (width < column − margin) so it never overflows and clips at
// the frame edge. 492×662 source, scaled by width.
const MEME_COLUMN_WIDTH = Math.round(WIDTH * 0.3); // 288
const MEME_RIGHT_MARGIN = 10;
const MEME_WIDTH = 250; // 250 + 10 margin = 260 < 288 → no clipping
const MEME_HEIGHT = Math.round((MEME_WIDTH * 662) / 492);

function layout(vm: ViewModel): ReactNode {
	return (
		<div
			style={{
				width: WIDTH,
				height: HEIGHT,
				backgroundColor: WHITE,
				color: BLACK,
				display: 'flex',
				flexDirection: 'row',
				alignItems: 'center',
				fontFamily: FAMILY,
				fontWeight: 700,
			}}
		>
			{/* Joke column (left) — fixed width so the text wraps within its
			    padding; a left margin off the frame edge and a gap before the face. */}
			<div
				style={{
					width: WIDTH - MEME_COLUMN_WIDTH,
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					paddingLeft: 28,
					paddingRight: 24,
				}}
			>
				<div style={{ fontSize: vm.fontSize, lineHeight: 1.25 }}>{vm.text}</div>
			</div>

			{/* Meme column (right) — right-aligned with a small right margin */}
			<div
				style={{
					width: MEME_COLUMN_WIDTH,
					height: '100%',
					display: 'flex',
					justifyContent: 'flex-end',
					alignItems: 'center',
					paddingRight: MEME_RIGHT_MARGIN,
				}}
			>
				<img src={MEME_SRC} width={MEME_WIDTH} height={MEME_HEIGHT} />
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
