// priority_split_v2 implementation: one Metlink call per target (uncached by
// design), maps failures to AppErrors, and returns the view model with
// rendering deferred. Same shape as v1 (issue #102), over the v2 NEXT/THEN
// slot model.

import type { PreparePrioritySplitV2Frame } from './prepare-priority-split-v2-frame';
import type { StopState } from '../../gateways/metlink/fetch-arrivals';
import { toAppError } from './errors';
import { padArrivalsForDev } from '../../debug/dev-pad-arrivals';
import { viewModelFromStopStates } from './domain-service';
import { toJsonView } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';

const preparePrioritySplitV2FrameImplementation: PreparePrioritySplitV2Frame = async (req) => {
  // A failed fetch short-circuits the frame by throwing the mapped problem type
  // (#59) rather than silently degrading — the renderFrame boundary turns the
  // throw into a problem+json response. A successful fetch (including a
  // legitimate closed/empty-feed stop) flows through to the view model and
  // renders a normal frame.
  const states: StopState[] = await Promise.all(
    req.targets.map(async (target) => {
      const result = await req.fetchArrivals(target);
      if (result.ok) return result.data;
      throw toAppError(result.error, target);
    }),
  );

  // Dev-only dogfooding aid (#108): pad sparse feeds so THEN/LATER populate.
  // Never true in production (DEV_PAD_LATER unset), so the live path is unchanged.
  const projected = req.padLater ? padArrivalsForDev(states, req.targets, req.now) : states;

  // The domain seam stays battery-agnostic (it speaks only transit); the
  // composition-root-derived battery is layered on here, the one place that sees it.
  const vm = { ...viewModelFromStopStates(req.targets, projected, req.timezone, req.now, req.runLimitMins), battery: req.battery };

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

export { preparePrioritySplitV2FrameImplementation };
