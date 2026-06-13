// Data contract for dual_month_calendar: the format-agnostic ViewModel and its JSON projection.

// One rendered month: caption ("June 2026"), rows of 7 cells Monday-start
// (null = blank leading/trailing cell), the day-of-month to highlight — set
// only on the grid containing today, null on the other — and the days that are
// public holidays (#84), shaded like weekends by the view.
export type MonthGrid = {
	caption: string;
	weeks: (number | null)[][];
	today: number | null;
	holidays: number[];
};

export type ViewModel = {
	slug: string;
	header: string;
	months: [MonthGrid, MonthGrid];
};

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). The ViewModel is a pure DTO, so the projection is the identity —
// a field added to the type can never silently miss the diagnostics view.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { ...vm };
}
