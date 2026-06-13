// priority_split implementation: one Metlink call per target (uncached by design), maps
// failures to AppErrors, and returns the view model with rendering deferred.

import type { PreparePrioritySplitFrame } from './prepare-priority-split-frame';
import type { StopState } from '../../gateways/metlink/fetch-arrivals';
import { toAppError } from './errors';
import { viewModelFromStopStates } from './domain-service';
import { toJsonView } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

const preparePrioritySplitFrameImplementation: PreparePrioritySplitFrame = async (req) => {
	// A failed fetch short-circuits the frame by throwing the mapped problem type
	// (#59) rather than silently degrading to a closed stop — the renderFrame
	// boundary turns the throw into a problem+json response. A successful fetch
	// (including a legitimate closed/empty-feed stop) flows through to the view
	// model and renders a normal frame.
	const states: StopState[] = await Promise.all(
		req.targets.map(async (target) => {
			const result = await req.fetchArrivals(target);
			if (result.ok) return result.data;
			throw toAppError(result.error, target);
		}),
	);

	const vm = viewModelFromStopStates(req.targets, states, req.timezone, req.now);

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

export { preparePrioritySplitFrameImplementation };
