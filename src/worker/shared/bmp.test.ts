import { describe, it, expect } from 'vitest';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from './bmp';

describe('rgbaTo1BitBmp', () => {
  it('encodes an all-white 960x540 RGBA buffer to a 64,862-byte BMP whose first two bytes are 0x42 0x4d', () => {
    const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
    rgba.fill(0xff);

    const bmp = rgbaTo1BitBmp(rgba);

    expect(bmp.length).toBe(64862);
    expect(bmp[0]).toBe(0x42);
    expect(bmp[1]).toBe(0x4d);
  });
});
