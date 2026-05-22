import { describe, it, expect } from 'vitest';
import { validate } from './index';

describe('auth.validate', () => {
	it('returns ok when X-Radiator-Token matches the shared token', () => {
		const headers = new Headers({ 'X-Radiator-Token': 'test-token-123' });

		const result = validate(headers, 'test-token-123');

		expect(result.ok).toBe(true);
	});
});
