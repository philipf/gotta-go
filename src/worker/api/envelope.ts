// Assembles the JSON view-model envelope for the `Accept: application/json`
// variant of GET /v1/frame (ADR-0004). The envelope leads with the
// cross-cutting diagnostics fields — the active profile phase, the layout, and
// the observability `server_time` that also rides the response headers — then
// spreads the layout's serialised view model (the structured input Satori was
// fed). `?include_bmp=1` appends `frame_bmp_base64`, decoding to the exact BMP
// an `Accept: image/bmp` sibling call would have produced at the same instant.

export type FrameEnvelopeInit = {
	profilePhase: string;
	layout: string;
	serverTime: Date;
	viewModel: Record<string, unknown>;
	// The rasterised BMP, present only when `?include_bmp=1` was requested.
	bmp: Uint8Array | null;
};

export function buildFrameEnvelope(init: FrameEnvelopeInit): Record<string, unknown> {
	const envelope: Record<string, unknown> = {
		profile_phase: init.profilePhase,
		layout: init.layout,
		server_time: init.serverTime.toISOString(),
		...init.viewModel,
	};
	if (init.bmp) envelope.frame_bmp_base64 = toBase64(init.bmp);
	return envelope;
}

// Chunked base64 of the raw BMP bytes. Chunking keeps the apply/spread off the
// 64 KB frame so a single String.fromCharCode call can't blow the arg-count
// limit; btoa is a Workers/Node global so no Buffer dependency is pulled in.
function toBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}
