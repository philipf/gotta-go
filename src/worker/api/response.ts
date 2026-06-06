// 200-OK frame response shaper per ADR-0003, plus the 304 Not Modified shaper
// for conditional frame requests (ADR-0013).

export type FrameOkInit = {
	gzip: boolean;
	sleepSeconds: number;
	serverTime: Date;
	profilePhase: string;
	// The weak ETag derived from the view model + LAYOUT_VERSION (ADR-0013).
	// Set on every 200 — the diagnostics variants carry it too, so a human on
	// curl can see the validator the BMP path would honour.
	etag: string;
};

// Shared shaper for the byte-body frame variants — the BMP (ADR-0003) and the
// diagnostics SVG (ADR-0004). Both carry the identical observability headers and
// follow the same ADR-0001 gzip transport rule; only the Content-Type differs.
function frameBody(
	contentType: string,
	body: Uint8Array,
	init: FrameOkInit,
): Response {
	const headers: Record<string, string> = {
		'Content-Type': contentType,
		ETag: init.etag,
		'X-Sleep-Seconds': String(init.sleepSeconds),
		'X-Server-Time': init.serverTime.toISOString(),
		'X-Profile-Phase': init.profilePhase,
	};
	if (init.gzip) headers['Content-Encoding'] = 'gzip';

	// encodeBody: 'manual' stops the Workers runtime from re-gzipping a body
	// we already compressed ourselves. The runtime's 'automatic' default
	// re-encodes any Content-Encoding: gzip response, producing double-gzipped
	// wire bytes — see GH #13 for the discovery + verification.
	return new Response(body, {
		status: 200,
		headers,
		encodeBody: init.gzip ? 'manual' : 'automatic',
	});
}

export function frameOk(body: Uint8Array, init: FrameOkInit): Response {
	return frameBody('image/bmp', body, init);
}

// 200-OK SVG diagnostics response for the `Accept: image/svg+xml` variant
// (ADR-0004). Returns the intermediate Satori SVG that the BMP encoder
// rasterises, gzipped per ADR-0001 like the BMP body. Carries the identical
// observability headers to frameOk so the variants are indistinguishable to a
// human comparing them; only the body and Content-Type differ.
export function frameSvg(body: Uint8Array, init: FrameOkInit): Response {
	return frameBody('image/svg+xml', body, init);
}

// 200-OK JSON diagnostics response for the `Accept: application/json` variant
// (ADR-0004). Carries the identical observability headers to frameOk so the two
// variants are indistinguishable to a human comparing them; only the body shape
// and Content-Type differ. Never gzipped — the diagnostics path is curl-facing
// and small, and the radiator never negotiates JSON.
export type FrameJsonInit = {
	sleepSeconds: number;
	serverTime: Date;
	profilePhase: string;
	etag: string;
};

export function frameJson(envelope: unknown, init: FrameJsonInit): Response {
	return new Response(JSON.stringify(envelope), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			ETag: init.etag,
			'X-Sleep-Seconds': String(init.sleepSeconds),
			'X-Server-Time': init.serverTime.toISOString(),
			'X-Profile-Phase': init.profilePhase,
		},
	});
}

// 304 Not Modified for a conditional frame request whose If-None-Match still
// matches (ADR-0013): the panel already shows this frame, so there is nothing
// to redraw. No body, no Content-Type, no Content-Encoding — the render
// pipeline never ran. X-Sleep-Seconds still rides the response (sleep
// authority is on every response per ADR-0003), and the ETag is repeated per
// RFC 9110 §15.4.5; the firmware ignores it (a new ETag is stored only after
// a successfully flushed 200).
export type FrameNotModifiedInit = {
	sleepSeconds: number;
	serverTime: Date;
	profilePhase: string;
	etag: string;
};

export function frameNotModified(init: FrameNotModifiedInit): Response {
	// No Content-Type and no body. Note workerd's HTTP-layer encoding
	// negotiation appends `Content-Encoding: gzip` to even this bodiless 304
	// whenever the request advertised Accept-Encoding (verified against
	// wrangler dev; same runtime behaviour GH #13 hit, and encodeBody:
	// 'manual' does not suppress it on a null body). Harmless — RFC 9110
	// permits representation metadata on a 304 and there is no body to decode
	// — and documented as incidental in the OpenAPI contract.
	return new Response(null, {
		status: 304,
		headers: {
			ETag: init.etag,
			'X-Sleep-Seconds': String(init.sleepSeconds),
			'X-Server-Time': init.serverTime.toISOString(),
			'X-Profile-Phase': init.profilePhase,
		},
	});
}
