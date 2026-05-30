// Builds the format-agnostic ViewModel for the minimal_clock layout:
// slug + 24-hour HH:MM wall-clock time + "Dow DD Mon" date in the supplied
// timezone.

import type { Radiator } from '../../config/lookup';
import { hhmm } from '../../shared/hhmm';

export type ViewModel = {
	slug: string;
	time: string;
	date: string;
};

// "Dow DD Mon" date formatting in the given timezone, without a date library.
// The HH:MM wall-clock comes from shared/hhmm; this DATE formatter has a single
// consumer, so it stays local (no speculative promotion). en-GB for short forms.
const DATE = new Map<string, Intl.DateTimeFormat>();

function dateFmt(tz: string): Intl.DateTimeFormat {
	let fmt = DATE.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			weekday: 'short',
			day: 'numeric',
			month: 'short',
		});
		DATE.set(tz, fmt);
	}
	return fmt;
}

export function buildViewModel(radiator: Radiator, timezone: string, now: Date): ViewModel {
	const time = hhmm(now, timezone);
	const parts = dateFmt(timezone).formatToParts(now);
	const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
	const dd = parts.find((p) => p.type === 'day')?.value ?? '';
	const mn = parts.find((p) => p.type === 'month')?.value ?? '';
	return {
		slug: radiator.slug,
		time,
		date: `${wd} ${dd} ${mn}`,
	};
}

// Serialises the view model verbatim for the JSON diagnostics envelope
// (ADR-0004). Single-word fields already match the glossary's wire vocabulary,
// so this is a straight projection — the JSON view is a serialiser of the type
// Satori receives, never a parallel definition.
export function toJsonView(vm: ViewModel): Record<string, unknown> {
	return { slug: vm.slug, time: vm.time, date: vm.date };
}
