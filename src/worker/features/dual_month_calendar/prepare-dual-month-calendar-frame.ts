// Public contract for the dual_month_calendar feature: prepare the calendar
// frame, with rendering deferred so the conditional-frame path (ADR-0013) never
// pays for rasterisation. Implementation in
// prepare-dual-month-calendar-frame-impl.ts; date derivation in domain-service.ts.
// Unlike the transit/joke features this capability never throws: holidays are
// decoration (#84), so a failed source soft-misses to an unshaded calendar.

import type { FetchHolidaysResponse } from '../../gateways/public_holidays/fetch-holidays';

export type PrepareDualMonthCalendarFrame = (
	req: PrepareDualMonthCalendarFrameRequest,
) => Promise<PrepareDualMonthCalendarFrameResponse>;

export type PrepareDualMonthCalendarFrameRequest = {
	// The household public-holidays source (#84), bound to the PUBLIC_HOLIDAYS KV
	// by the composition root. A failed read degrades to an unshaded calendar — the
	// soft-miss lives in the impl, so this capability never throws.
	fetchHolidays: HolidaySource;
	// The radiator slug, surfaced in the diagnostics view.
	slug: string;
	timezone: string;
	now: Date;
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
