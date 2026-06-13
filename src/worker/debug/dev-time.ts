// Server-time override for diagnostics: when DEV_TIME_OVERRIDE is set and the request
// carries X-Debug-Now, that timestamp replaces the real clock for phase resolution.

export function resolveDevNow(request: Request, env: Env): Date | undefined {
	if (env.DEV_TIME_OVERRIDE !== 'true') return undefined;
	const raw = request.headers.get('X-Debug-Now');
	if (!raw) return undefined;
	const t = new Date(raw);
	return Number.isNaN(t.getTime()) ? undefined : t;
}
