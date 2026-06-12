// Data contract for the idle_jokes feature: the private, format-agnostic
// ViewModel that prepare-joke-frame-impl.ts derives and view.tsx renders.
// Logic-free — a DTO plus its JSON projection — so this file answers only
// "what shape does this feature draw?"; the derivation lives in the impl.

export type ViewModel = {
	text: string;
	id: string;
};

// Serialises the view model for the JSON diagnostics envelope (ADR-0004). A
// real projection: text + id map onto the glossary wire names. Font sizing is a
// view concern (view.tsx), so it never reached the wire view anyway.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { joke: vm.text, jokeId: vm.id };
}
