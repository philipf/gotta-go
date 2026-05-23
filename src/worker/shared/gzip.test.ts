import { describe, it, expect } from 'vitest';
import { gzip } from './gzip';

describe('gzip', () => {
	it('produces fewer bytes than the input for a repetitive payload', async () => {
		const input = new Uint8Array(8192);
		input.fill(0x41); // 'A' * 8192 — highly compressible

		const out = await gzip(input);

		expect(out.length).toBeGreaterThan(0);
		expect(out.length).toBeLessThan(input.length);
	});
});
