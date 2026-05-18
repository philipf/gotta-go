import { readFile, writeFile } from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const WIDTH = 960;
const HEIGHT = 540;

async function loadSvg(usePattern: boolean): Promise<string> {
	if (usePattern) return buildPatternSvg();
	return readFile(new URL('./input.svg', import.meta.url), 'utf8');
}

function buildPatternSvg(): string {
	const checker: string[] = [];
	const cell = 8;
	for (let y = 0; y < HEIGHT; y += cell) {
		for (let x = 0; x < WIDTH; x += cell) {
			if (((x / cell + y / cell) & 1) === 0) {
				checker.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="#000"/>`);
			}
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
		<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>
		${checker.join('')}
		<line x1="0" y1="0" x2="${WIDTH - 1}" y2="${HEIGHT - 1}" stroke="#000" stroke-width="1"/>
		<rect x="0" y="0" width="${WIDTH}" height="40" fill="#fff"/>
		<text x="20" y="28" font-family="Press Start 2P" font-size="16" fill="#000">PATTERN checker + diagonal</text>
	</svg>`;
}

async function renderRgba(svg: string): Promise<Uint8Array> {
	const wasm = await readFile(
		new URL('./node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url),
	);
	await initWasm(wasm);

	const pressStartTtf = await readFile(
		new URL('./PressStart2P-Regular.ttf', import.meta.url),
	);

	const r = new Resvg(svg, {
		fitTo: { mode: 'width', value: WIDTH },
		font: {
			fontBuffers: [pressStartTtf],
			defaultFontFamily: 'Press Start 2P',
			loadSystemFonts: false,
		},
	});
	return r.render().pixels;
}

function rgbaTo1BitBmp(rgba: Uint8Array, w = WIDTH, h = HEIGHT): Uint8Array {
	const rowBytes = w >> 3;
	const pixels = new Uint8Array(rowBytes * h);

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const a = rgba[i + 3] / 255;
			const lum =
				a * (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) +
				(1 - a) * 255;
			if (lum < 128) pixels[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}

	const buf = new Uint8Array(62 + pixels.length);
	const dv = new DataView(buf.buffer);
	buf[0] = 0x42;
	buf[1] = 0x4d;
	dv.setUint32(2, buf.length, true);
	dv.setUint32(10, 62, true);
	dv.setUint32(14, 40, true);
	dv.setInt32(18, w, true);
	dv.setInt32(22, -h, true);
	dv.setUint16(26, 1, true);
	dv.setUint16(28, 1, true);
	dv.setUint32(34, pixels.length, true);
	dv.setUint32(46, 2, true);
	buf.set([0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00], 54);
	buf.set(pixels, 62);
	return buf;
}

async function main() {
	const usePattern = process.argv.includes('--pattern');
	const outPath = new URL(usePattern ? './pattern.bmp' : './out.bmp', import.meta.url);

	const t0 = performance.now();
	const svg = await loadSvg(usePattern);
	const t1 = performance.now();
	const rgba = await renderRgba(svg);
	const t2 = performance.now();
	const bmp = rgbaTo1BitBmp(rgba);
	const t3 = performance.now();
	await writeFile(outPath, bmp);

	console.log(`svg load:    ${(t1 - t0).toFixed(1)} ms`);
	console.log(`resvg:       ${(t2 - t1).toFixed(1)} ms  (${rgba.length} bytes RGBA)`);
	console.log(`bmp encode:  ${(t3 - t2).toFixed(1)} ms  (${bmp.length} bytes)`);
	console.log(`wrote:       ${outPath.pathname}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
