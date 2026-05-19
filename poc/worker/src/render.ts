import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import pressStartTtf from './PressStart2P-Regular.ttf';
import { WIDTH } from './bmp';

let wasmReady: Promise<void> | null = null;
const ensureWasm = () => (wasmReady ??= initWasm(resvgWasm));

export async function renderSvgToRgba(svg: string): Promise<Uint8Array> {
	await ensureWasm();
	const r = new Resvg(svg, {
		fitTo: { mode: 'width', value: WIDTH },
		font: {
			fontBuffers: [new Uint8Array(pressStartTtf)],
			defaultFontFamily: 'Press Start 2P',
			loadSystemFonts: false,
		},
	});
	return r.render().pixels;
}
