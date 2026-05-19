import { describe, it, expect } from "vitest";
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from "../src/bmp";

// Satori's internal yoga-wasm calls `WebAssembly.instantiate` at runtime,
// which the vitest-pool-workers sandbox blocks (the dev + prod runtimes both
// allow it). So in-sandbox tests cover just the pure-JS BMP encoder; the
// full JSX → satori → resvg → bmp pipeline is validated by the deploy gate.

describe("rgbaTo1BitBmp", () => {
	it("encodes a fully-white frame to a valid 64 862-byte BMP1", () => {
		const rgba = new Uint8Array(WIDTH * HEIGHT * 4).fill(0xff);
		const bmp = rgbaTo1BitBmp(rgba);

		expect(bmp.length).toBe(64_862);
		expect(bmp[0]).toBe(0x42);
		expect(bmp[1]).toBe(0x4d);
	});
});
