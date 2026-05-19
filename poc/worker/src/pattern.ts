import { WIDTH, HEIGHT } from './bmp';

const CELL = 8;

export function buildCheckerboardRgba(w = WIDTH, h = HEIGHT): Uint8Array {
	const rgba = new Uint8Array(w * h * 4);
	rgba.fill(0xff);

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const cellOn = (((x / CELL) | 0) + ((y / CELL) | 0)) & 1;
			if (cellOn === 0) setPixel(rgba, w, x, y, 0, 0, 0);
		}
	}

	const dxdy = (w - 1) / (h - 1);
	for (let y = 0; y < h; y++) {
		const x = Math.round(y * dxdy);
		setPixel(rgba, w, x, y, 0, 0, 0);
	}

	return rgba;
}

function setPixel(rgba: Uint8Array, w: number, x: number, y: number, r: number, g: number, b: number) {
	const i = (y * w + x) * 4;
	rgba[i] = r;
	rgba[i + 1] = g;
	rgba[i + 2] = b;
	rgba[i + 3] = 0xff;
}
