// Data contract for the idle_jokes layout: the format-agnostic ViewModel that
// service.ts builds (phase 1) and view.tsx renders (phase 2). Deliberately
// logic-free — a DTO plus its JSON projection — so this file answers only
// "what shape does this layout draw?"; every derivation lives in service.ts.

export type ViewModel = {
	text: string;
	id: string;
	fontSize: number;
};

// Serialises the view model for the JSON diagnostics envelope (ADR-0004). A
// real projection, not the identity: text + id map onto the glossary wire
// names, and fontSize is a render-only detail that stays out of the wire view.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { joke: vm.text, jokeId: vm.id };
}
