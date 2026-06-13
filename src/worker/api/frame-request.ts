// Inbound request shaper for GET /v1/frame (REPR: the request side). Parses the
// raw Request once into the FrameRequest the orchestrator works with — radiator
// identity, telemetry headers, and the negotiated response shape — and derives
// the observability context spread into every log event. Shared by both frame
// entry points (handleFrame, handleTestFrame) via renderFrame; knows nothing
// about orchestration, auth, or response shaping.

import { resolveResponseFormat } from './format';
import type { ResponseFormat } from './format';

// Everything renderFrame needs from the raw Request, parsed once: the radiator
// identity + telemetry headers and the negotiated response shape. includeBmp
// is meaningful only on the JSON diagnostics path (`?include_bmp=1` — lets the
// common JSON case skip the Satori/resvg pipeline entirely); ifNoneMatch is
// the conditional-request validator (ADR-0013).
export type FrameRequest = {
	slug: string;
	hardwareId: string | undefined;
	requestId: string | undefined;
	batteryMv: number | undefined;
	format: ResponseFormat;
	includeBmp: boolean;
	acceptsGzip: boolean;
	ifNoneMatch: string | null;
};

export function parseFrameRequest(request: Request): FrameRequest {
	const format = resolveResponseFormat(request.headers.get('Accept'));
	return {
		slug: request.headers.get('X-Radiator-Slug') ?? '',
		hardwareId: request.headers.get('X-Radiator-Hardware-Id') ?? undefined,
		requestId: request.headers.get('X-Request-Id') ?? undefined,
		batteryMv: parseBatteryMv(request.headers.get('X-Radiator-Battery-Mv')),
		format,
		includeBmp:
			format === 'json' &&
			new URL(request.url).searchParams.get('include_bmp') === '1',
		acceptsGzip: (request.headers.get('Accept-Encoding') ?? '').includes('gzip'),
		ifNoneMatch: request.headers.get('If-None-Match'),
	};
}

// Observability context (GH #25), spread into every log event: hardwareId (the
// firmware-sent MAC) and the optional client-supplied requestId give per-device
// / cross-system correlation; batteryMv (GH #78) is the per-wake battery
// telemetry. Undefined values are dropped by JSON.stringify, so they need no
// conditional spread. Timing is owned by CF trace spans (observability.traces),
// not logged here — workerd freezes Date.now() between I/O so an in-script delta
// misleads (#54).
export function extractObservabilityInfo(req: FrameRequest) {
	return {
		batteryMv: req.batteryMv,
		hardwareId: req.hardwareId,
		requestId: req.requestId,
		slug: req.slug,
	};
}

// Battery telemetry (GH #78): X-Radiator-Battery-Mv carries the radiator's raw
// battery voltage in millivolts. Parsed to a number so CF Workers Logs can
// range-query it (e.g. batteryMv < 3500); anything absent, non-integer, or
// negative becomes undefined — the field is silently dropped from the log line,
// never a request rejection, per the X-Radiator-* reserved-namespace rule.
function parseBatteryMv(raw: string | null): number | undefined {
	if (raw === null || raw.trim() === '') return undefined;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 0 ? n : undefined;
}
