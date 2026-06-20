import { describe, it, expect } from 'vitest';
import { auth } from './auth';

describe('auth', () => {
  it('returns ok when the Authorization bearer token matches the shared token', () => {
    const headers = new Headers({ Authorization: 'Bearer test-token-123' });

    const result = auth(headers, 'test-token-123');

    expect(result.ok).toBe(true);
  });

  it('returns not-ok when Authorization is missing', () => {
    const headers = new Headers();

    const result = auth(headers, 'test-token-123');

    expect(result.ok).toBe(false);
  });

  it('returns not-ok when the Authorization bearer token does not match', () => {
    const headers = new Headers({ Authorization: 'Bearer wrong-token' });

    const result = auth(headers, 'test-token-123');

    expect(result.ok).toBe(false);
  });

  it('returns not-ok when Authorization is present but not a Bearer scheme', () => {
    const headers = new Headers({ Authorization: 'test-token-123' });

    const result = auth(headers, 'test-token-123');

    expect(result.ok).toBe(false);
  });

  // Legacy fallback — remove with the X-Radiator-Token branch once all
  // radiators send Authorization (GH #121).
  it('returns ok when the legacy X-Radiator-Token matches the shared token', () => {
    const headers = new Headers({ 'X-Radiator-Token': 'test-token-123' });

    const result = auth(headers, 'test-token-123');

    expect(result.ok).toBe(true);
  });

  it('returns not-ok when the legacy X-Radiator-Token does not match', () => {
    const headers = new Headers({ 'X-Radiator-Token': 'wrong-token' });

    const result = auth(headers, 'test-token-123');

    expect(result.ok).toBe(false);
  });
});
