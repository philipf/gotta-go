// Data contract for the minimal_clock layout: the format-agnostic ViewModel
// that prepare-minimal-clock-frame-impl.ts builds and view.tsx renders.
// Deliberately logic-free — a DTO plus its JSON projection — so this file
// answers only "what shape does this layout draw?"; the derivation lives in
// prepare-minimal-clock-frame-impl.ts.

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
