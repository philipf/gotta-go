// Manual 1-bit BMP encoder. Converts an RGBA pixel buffer to a 960×540
// 1-bit monochrome BMP byte array — the wire format the LilyGO T5 EPD panel
// flushes directly. Exports the canonical WIDTH/HEIGHT used by every renderer.

export const WIDTH = 960;
export const HEIGHT = 540;

export function rgbaTo1BitBmp(rgba: Uint8Array, w = WIDTH, h = HEIGHT): Uint8Array {
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
