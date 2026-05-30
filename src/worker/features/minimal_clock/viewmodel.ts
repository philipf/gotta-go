// Builds the format-agnostic ViewModel for the minimal_clock layout:
// slug + 24-hour HH:MM wall-clock time + "Dow DD Mon" date in the supplied
// timezone.

import type { Radiator } from '../../config/lookup';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';

export type ViewModel = {
	slug: string;
	time: string;
	date: string;
};

export function buildViewModel(radiator: Radiator, timezone: string, now: Date): ViewModel {
	return {
		slug: radiator.slug,
		time: hhmm(now, timezone),
		date: shortDate(now, timezone),
	};
}

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). Single-word fields already match the glossary's wire vocabulary,
// so this is a straight projection — the JSON view is a serialiser of the type
// Satori receives, never a parallel definition.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { slug: vm.slug, time: vm.time, date: vm.date };
}
