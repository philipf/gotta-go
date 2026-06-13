// idle_jokes implementation: fetches a dad joke, maps failure to an AppError, and returns
// the view model with rendering deferred; no wall-clock date (idle sleeps up to 4h).

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
