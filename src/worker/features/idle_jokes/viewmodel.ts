// Data contract for the idle_jokes feature: the private, format-agnostic
// ViewModel that prepare-joke-frame-impl.ts derives and view.tsx renders.
// Logic-free — a DTO plus its JSON projection — so this file answers only
// "what shape does this feature draw?"; the derivation lives in the impl.

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
