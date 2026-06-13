// dual_month_calendar implementation: loads holidays (soft-missing to unshaded on failure),
// derives the view model, and returns it with rendering deferred.

import type { PrepareDualMonthCalendarFrame, HolidaySource } from './prepare-dual-month-calendar-frame';
import { buildCalendarViewModel } from './domain-service';
import { toJsonView } from './viewmodel';
import { LAYOUT_VERSION, renderBmp, renderSvg } from './view';
import { log } from '../../shared/log';

// Holidays are decoration (#84): a missing key or KV error degrades to an
// unshaded calendar, never an error frame. The gateway is a pure bulkhead, so
// the soft-miss and its diagnostic log live here, at the one caller that wants it.
async function loadHolidays(source: HolidaySource): Promise<Set<string>> {
	const res = await source();
	if (res.ok) return res.data;
	log.warn(`public_holidays.${res.error.kind}`, { detail: res.error.detail });
	return new Set();
}

const prepareDualMonthCalendarFrameImplementation: PrepareDualMonthCalendarFrame = async (req) => {
	const holidays = await loadHolidays(req.fetchHolidays);
	const vm = buildCalendarViewModel(req.now, req.timezone, req.slug, holidays);

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

export { prepareDualMonthCalendarFrameImplementation };
