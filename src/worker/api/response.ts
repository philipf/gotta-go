// 200-OK frame response shaper per ADR-0003.

export type FrameOkInit = {
	gzip: boolean;
	sleepSeconds: number;
	serverTime: Date;
	profilePhase: string;
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
};

export function frameJson(envelope: unknown, init: FrameJsonInit): Response {
	return new Response(JSON.stringify(envelope), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'X-Sleep-Seconds': String(init.sleepSeconds),
			'X-Server-Time': init.serverTime.toISOString(),
			'X-Profile-Phase': init.profilePhase,
		},
	});
}
