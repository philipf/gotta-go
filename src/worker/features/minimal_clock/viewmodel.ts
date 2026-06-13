// Data contract for minimal_clock: the format-agnostic ViewModel and its JSON projection.

export type ViewModel = {
	slug: string;
	time: string;
	date: string;
};

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). The ViewModel is a pure DTO, so the projection is the identity —
// a field added to the type can never silently miss the diagnostics view.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { ...vm };
}
