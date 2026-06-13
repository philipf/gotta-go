// Wire→domain mapper for public_holidays: { date, name } entries → Set of ISO date strings;
// malformed entries are dropped, not fatal.

export function toHolidayDates(entries: unknown[]): Set<string> {
  return new Set(entries.map(entryDate).filter((d): d is string => d !== null));
}

function entryDate(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const date = (entry as Record<string, unknown>).date;
  return typeof date === 'string' ? date : null;
}
