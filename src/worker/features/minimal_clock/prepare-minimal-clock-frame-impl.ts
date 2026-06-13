// Implementation of the minimal_clock capability: derive the view model — slug
// + 24-hour HH:MM wall-clock time + "Dow DD Mon" date in the supplied timezone,
// no external fetch — and return it with rendering deferred (the 304 path must
// never rasterise — ADR-0013). The derivation is trivial enough to live inline;
// no domain-service.ts is earned.

import type { PrepareMinimalClockFrame } from './prepare-minimal-clock-frame';
import { hhmm } from '../../shared/hhmm';
import { shortDate } from '../../shared/shortDate';
import { toJsonView, type ViewModel } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

const prepareMinimalClockFrameImplementation: PrepareMinimalClockFrame = async (req) => {
	const vm: ViewModel = {
		slug: req.slug,
		time: hhmm(req.now, req.timezone),
		date: shortDate(req.now, req.timezone),
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

export { prepareMinimalClockFrameImplementation };
