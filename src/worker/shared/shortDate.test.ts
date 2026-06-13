import { describe, it, expect } from 'vitest';
import { shortDate } from './shortDate';

describe('shortDate', () => {
  it('formats a "Dow DD Mon" date in the given timezone', () => {
    // 2026-05-22T19:30:00Z is Fri 22 May in UTC but 07:30 the next day in
    // Pacific/Auckland (+12), so the local date has already rolled to Sat 23 May.
    const t = new Date('2026-05-22T19:30:00Z');
    expect(shortDate(t, 'UTC')).toBe('Fri 22 May');
    expect(shortDate(t, 'Pacific/Auckland')).toBe('Sat 23 May');
  });

  it('reflects the timezone when the instant straddles midnight', () => {
    // 2026-05-30T13:05:00Z is 30 May in UTC but 31 May in Auckland (+12).
    const t = new Date('2026-05-30T13:05:00Z');
    expect(shortDate(t, 'UTC')).toBe('Sat 30 May');
    expect(shortDate(t, 'Pacific/Auckland')).toBe('Sun 31 May');
  });
});
