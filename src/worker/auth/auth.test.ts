import { describe, it, expect } from 'vitest';
import { validate } from './validate';

describe('auth.validate', () => {
	it('returns ok when X-Radiator-Token matches the shared token', () => {
		const headers = new Headers({ 'X-Radiator-Token': 'test-token-123' });

		const result = validate(headers, 'test-token-123');

		expect(result.ok).toBe(true);
	});

	it('returns not-ok when X-Radiator-Token is missing', () => {
		const headers = new Headers();

		const result = validate(headers, 'test-token-123');

		expect(result.ok).toBe(false);
	});

	it('returns not-ok when X-Radiator-Token does not match the shared token', () => {
		const headers = new Headers({ 'X-Radiator-Token': 'wrong-token' });

		const result = validate(headers, 'test-token-123');

		expect(result.ok).toBe(false);
	});
});
