// Dependency-free structured logger for Cloudflare Workers observability (GH #25).
// Each call emits a single JSON line via the console method matching its level,
// so CF Workers Logs both (a) classifies the entry under its native Level facet
// — driven by the console method, not the payload — and (b) indexes every field
// for querying (e.g. event, hardwareId, durationMs). `event` is a dotted name
// (e.g. "frame.completed") that forms the dashboard query vocabulary; `fields`
// are merged in flat alongside `level` and `event`. No timestamp — CF stamps
// each event itself.

type Fields = Record<string, unknown>;

function emit(
	method: 'log' | 'warn' | 'error',
	level: 'info' | 'warn' | 'error',
	event: string,
	fields?: Fields,
): void {
	console[method](JSON.stringify({ level, event, ...fields }));
}

export const log = {
	info: (event: string, fields?: Fields) => emit('log', 'info', event, fields),
	warn: (event: string, fields?: Fields) => emit('warn', 'warn', event, fields),
	error: (event: string, fields?: Fields) => emit('error', 'error', event, fields),
};
