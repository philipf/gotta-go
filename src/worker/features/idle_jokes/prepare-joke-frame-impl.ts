// Implementation of the idle_jokes capability: fetch a random dad joke via the
// injected source, map any failure to an AppError (errors.ts), derive the
// private view model, and return it with rendering deferred (the 304 path must
// never rasterise — ADR-0013). No wall-clock/date by design (#17): the idle
// profile sleeps up to 4h, so any rendered time would be stale.

import type { PrepareJokeFrame } from './prepare-joke-frame';
import { toAppError } from './errors';
import { toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

const prepareJokeFrameImplementation: PrepareJokeFrame = async (req) => {
	const result = await req.fetchJoke();
	if (!result.ok) throw toAppError(result.error);

	const vm: ViewModel = {
		text: result.data.text,
		id: result.data.id,
	};

	return {
		view: toJsonView(vm),
		version: LAYOUT_VERSION,
		// Lazy render closure: closes over the private view model and the requested
		// flags, so a 304 returns without entering Satori. Safe to call with both
		// flags false — it never rasterises (resolves { frame: null, svg: null }).
		render: async () => ({
			frame: req.includeBmp ? await renderBmp(vm) : null,
			svg: req.includeSvg ? await renderSvg(vm) : null,
		}),
	};
};

export { prepareJokeFrameImplementation };
