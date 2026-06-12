// Implementation of the idle_jokes capability: fetch a random dad joke via the
// injected source, map any failure to an AppError (errors.ts), derive the
// private view model, and return it with rendering deferred (the 304 path must
// never rasterise — ADR-0013). No wall-clock/date by design (#17): the idle
// profile sleeps up to 4h, so any rendered time would be stale.

import type { PrepareJokeFrame } from './prepare-joke-frame';
import { toAppError } from './errors';
import { toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

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

// FIX: this might not surive our refactoring at all, AI and I will have a discussion first about this pattern
// NOTE: resolved — the two-phase Layout object is gone; this is a single capability
// returning the cheap view/version plus a deferred render closure (ADR-0017 §2).
const prepareJokeFrameImplementation: PrepareJokeFrame = async (req) => {
	const result = await req.fetchJoke();
	if (!result.ok) throw toAppError(result.error);

	const vm: ViewModel = {
		text: result.data.text,
		id: result.data.id,
		fontSize: fontSizeFor(result.data.text),
	};

	return {
		view: toJsonView(vm),
		version: LAYOUT_VERSION,
		// Deferred: closes over the private view model and the requested flags, so
		// a 304 returns without entering Satori. Safe to call with both flags
		// false — it never rasterises (resolves { frame: null, svg: null }).
		render: async () => ({
			frame: req.includeBmp ? await renderBmp(vm) : null,
			svg: req.includeSvg ? await renderSvg(vm) : null,
		}),
	};
};

export { prepareJokeFrameImplementation };
