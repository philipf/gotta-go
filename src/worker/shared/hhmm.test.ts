import { describe, it, expect } from 'vitest';
import { hhmm } from './hhmm';

describe('hhmm', () => {
  it('formats a 24-hour HH:MM wall-clock in the given timezone', () => {
    // 2026-05-30T06:30:00Z is 18:30 the same day in Pacific/Auckland (+12).
    const t = new Date('2026-05-30T06:30:00Z');
    expect(hhmm(t, 'Pacific/Auckland')).toBe('18:30');
    expect(hhmm(t, 'UTC')).toBe('06:30');
  });

  it('zero-pads the hour and uses 24-hour time past noon', () => {
    const t = new Date('2026-05-30T13:05:00Z');
    expect(hhmm(t, 'UTC')).toBe('13:05');
  });
});
