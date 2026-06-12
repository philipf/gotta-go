// The only file that performs the wire→domain transformation (ADR-0005 §rule 2):
// the stored { date, name } entries become a domain Set of ISO date strings. The
// `name` is dropped — no caller renders it (#84) — and the payload is untrusted, so
// each entry is validated and a malformed one is dropped, never fatal.

export function toHolidayDates(entries: unknown[]): Set<string> {
	return new Set(entries.map(entryDate).filter((d): d is string => d !== null));
}

function entryDate(entry: unknown): string | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const date = (entry as Record<string, unknown>).date;
	return typeof date === 'string' ? date : null;
}
