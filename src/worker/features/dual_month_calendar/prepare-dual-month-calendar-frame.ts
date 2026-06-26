// Public contract for dual_month_calendar: prepare the calendar frame with rendering deferred.

import type { FetchHolidaysResponse } from '../../gateways/public_holidays/fetch-holidays';
import type { BatteryIndicatorState } from '../../shared/battery/derive';

export type PrepareDualMonthCalendarFrame = (req: PrepareDualMonthCalendarFrameRequest) => Promise<PrepareDualMonthCalendarFrameResponse>;

export type PrepareDualMonthCalendarFrameRequest = {
  // The household public-holidays source (#84), bound to the PUBLIC_HOLIDAYS KV
  // by the composition root. A failed read degrades to an unshaded calendar — the
  // soft-miss lives in the impl, so this capability never throws.
  fetchHolidays: HolidaySource;
  // The radiator slug, surfaced in the diagnostics view.
  slug: string;
  timezone: string;
  now: Date;
  // The derived battery indicator state, or null when the reading is absent —
  // already mapped from mV by the composition root. null hides the indicator.
  battery: BatteryIndicatorState | null;
  // Artefact flags — format negotiation already collapsed by the caller.
  includeBmp: boolean;
  includeSvg: boolean;
};

export type PrepareDualMonthCalendarFrameResponse = {
  view: Record<string, unknown>; // JSON projection — diagnostics + ETag input
  version: number; // appearance revision — ETag input
  render: () => Promise<DualMonthCalendarRenderResult>; // deferred; closes over the private VM
};

export type HolidaySource = () => Promise<FetchHolidaysResponse>;

export type DualMonthCalendarRenderResult = {
  frame: Uint8Array | null;
  svg: string | null;
};

export { prepareDualMonthCalendarFrameImplementation as prepareDualMonthCalendarFrame } from './prepare-dual-month-calendar-frame-impl';
