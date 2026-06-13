// Structured JSON logger for Cloudflare Workers: one JSON line per call via the console
// method matching the level, so CF Workers Logs classifies and indexes every field.

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
