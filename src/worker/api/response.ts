// 200-OK frame response shaper per ADR-0003.

export type FrameOkInit = {
	gzip: boolean;
	sleepSeconds: number;
	serverTime: Date;
	profilePhase: string;
};

export function frameOk(body: Uint8Array, init: FrameOkInit): Response {
	const headers: Record<string, string> = {
		'Content-Type': 'image/bmp',
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
