// 24-hour "HH:MM" wall-clock formatting in an arbitrary timezone; Intl.DateTimeFormat
// memoised per timezone because it is the expensive part.

const FMT = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let fmt = FMT.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    FMT.set(tz, fmt);
  }
  return fmt;
}

export function hhmm(date: Date, tz: string): string {
  return formatter(tz).format(date);
}
