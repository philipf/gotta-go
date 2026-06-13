import { describe, it, expect } from 'vitest';
import { auth } from './auth';

describe('auth', () => {
	it('returns ok when X-Radiator-Token matches the shared token', () => {
		const headers = new Headers({ 'X-Radiator-Token': 'test-token-123' });

		const result = auth(headers, 'test-token-123');

		expect(result.ok).toBe(true);
	});

	it('returns not-ok when X-Radiator-Token is missing', () => {
		const headers = new Headers();

		const result = auth(headers, 'test-token-123');

		expect(result.ok).toBe(false);
	});

	it('returns not-ok when X-Radiator-Token does not match the shared token', () => {
		const headers = new Headers({ 'X-Radiator-Token': 'wrong-token' });

		const result = auth(headers, 'test-token-123');

		expect(result.ok).toBe(false);
	});
});
