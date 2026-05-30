// Shared Satori + resvg rendering pipeline used by BMP renderers. Lazy-
// initialises the Yoga + resvg WebAssembly modules once per Worker isolate
// (deferred to first request to keep cold-start CPU budget low), loads the
// bundled DejaVu Sans Bold TTF, and exposes jsxToSvg and svgToRgba.
// Typeface decision: ADR-0009 (replaces the prior Press Start 2P pixel font).

import { initWasm as initResvg, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import satori, { init as initSatori } from 'satori/standalone';
import yogaWasm from 'satori/yoga.wasm';
import type { ReactNode } from 'react';
import dejaVuTtf from '../assets/DejaVuSans-Bold.ttf';
import { WIDTH, HEIGHT } from './bmp';

// The bundled face is the Bold weight; layouts set fontWeight: 700 so Satori
// matches it. resvg picks the face from the buffer, so defaultFontFamily only
// needs the family name.
const FAMILY = 'DejaVu Sans';
const fontBuffer = new Uint8Array(dejaVuTtf);

// Cold-start defence: both wasm modules are imported as pre-compiled
// `WebAssembly.Module`s (wrangler/esbuild compile them at deploy time). We
// instantiate them lazily on first request, memoized per isolate, so the cost
// lands in the request CPU budget rather than the much tighter ~1s startup
// budget. The previous `import satori from 'satori'` auto-fired yoga's wasm
// init at module evaluation, which hung first cold requests.
let wasmReady: Promise<void> | null = null;
const ensureWasm = () =>
	(wasmReady ??= Promise.all([initSatori(yogaWasm), initResvg(resvgWasm)]).then(() => undefined));

export async function jsxToSvg(tree: ReactNode): Promise<string> {
	await ensureWasm();
	return satori(tree, {
		width: WIDTH,
		height: HEIGHT,
		fonts: [{ name: FAMILY, data: fontBuffer, weight: 700, style: 'normal' }],
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
