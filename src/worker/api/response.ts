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
