import { describe, it, expect } from 'vitest';
import { resolveResponseFormat } from './format';

describe('api.format.resolveResponseFormat', () => {
	it('resolves a missing Accept header to bmp (the radiator path)', () => {
		expect(resolveResponseFormat(null)).toBe('bmp');
	});

	it('resolves Accept: image/bmp to bmp', () => {
		expect(resolveResponseFormat('image/bmp')).toBe('bmp');
	});

	it('resolves Accept: application/json to json', () => {
		expect(resolveResponseFormat('application/json')).toBe('json');
	});

	it('resolves a json-bearing multi-type Accept to json', () => {
		expect(resolveResponseFormat('application/json, text/plain')).toBe('json');
	});
});
