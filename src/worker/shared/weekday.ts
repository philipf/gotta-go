// Lowercase 3-letter weekday token ("mon".."sun") for an instant in an arbitrary timezone;
// Intl.DateTimeFormat memoised per timezone because it is the expensive part.

import type { Weekday } from '../config/config-types';

const FMT = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let fmt = FMT.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
    });
    FMT.set(tz, fmt);
  }
  return fmt;
}

export function weekday(date: Date, tz: string): Weekday {
  return formatter(tz).format(date).toLowerCase().slice(0, 3) as Weekday;
}
