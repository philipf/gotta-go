// Builds the format-agnostic ViewModel for the idle_jokes layout: the joke text,
// its upstream id (diagnostics), and a font size stepped by length so a short
// one-liner fills the column and a long joke still fits and stays legible in the
// 70% text pane. No wall-clock/date — the idle profile sleeps up to 4h, so any
// rendered time would be stale (#17 grill).

import type { Joke } from '../../gateways/icanhazdadjoke/icanhazdadjoke';

export type ViewModel = {
	text: string;
	id: string;
	fontSize: number;
};

// Length buckets (characters) → px. Tuned for the ~620px-wide joke column at
// 540px tall; verify live per ADR-0009. Three steps keep short jokes deliberate
// and long ones from overflowing.
const SHORT = 70;
const MEDIUM = 130;
const FONT_LARGE = 51;
const FONT_MEDIUM = 38;
const FONT_SMALL = 29;

function fontSizeFor(text: string): number {
	if (text.length <= SHORT) return FONT_LARGE;
	if (text.length <= MEDIUM) return FONT_MEDIUM;
	return FONT_SMALL;
}

export function buildViewModel(joke: Joke): ViewModel {
	return {
		text: joke.text,
		id: joke.id,
		fontSize: fontSizeFor(joke.text),
	};
}

// Serialises the view model for the JSON diagnostics envelope (ADR-0004). The
// joke + its id are the meaningful fields; fontSize is a render-only detail, so
// it stays out of the wire view.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { joke: vm.text, jokeId: vm.id };
}
