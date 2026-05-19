import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import satori from 'satori';
import type { ReactNode } from 'react';
import pressStartTtf from './PressStart2P-Regular.ttf';
import { WIDTH, HEIGHT } from './bmp';

const FAMILY = 'Press Start 2P';
const fontBuffer = new Uint8Array(pressStartTtf);

let wasmReady: Promise<void> | null = null;
const ensureWasm = () => (wasmReady ??= initWasm(resvgWasm));

export async function jsxToSvg(tree: ReactNode): Promise<string> {
	return satori(tree, {
		width: WIDTH,
		height: HEIGHT,
		fonts: [{ name: FAMILY, data: fontBuffer, weight: 400, style: 'normal' }],
	});
}

export async function svgToRgba(svg: string): Promise<Uint8Array> {
	await ensureWasm();
	const r = new Resvg(svg, {
		fitTo: { mode: 'width', value: WIDTH },
		font: {
			fontBuffers: [fontBuffer],
			defaultFontFamily: FAMILY,
			loadSystemFonts: false,
		},
	});
	return r.render().pixels;
}
