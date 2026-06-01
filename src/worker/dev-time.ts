// Server-time override for diagnostics. When DEV_TIME_OVERRIDE is enabled (a
// flag set via .dev.vars locally or a Cloudflare secret in production) and the
// request carries an X-Debug-Now header with a parseable timestamp, that
// instant replaces the real clock — letting an operator drive time-of-day phase
// resolution (e.g. preview morning_school_run outside 07:15–08:30, or diagnose
// a production phase issue) from curl or the radiator. Returns undefined in
// every other case — including any request without X-Debug-Now — so the real
// clock is used unless the override is both enabled and explicitly requested.

export function resolveDevNow(request: Request, env: Env): Date | undefined {
	if (env.DEV_TIME_OVERRIDE !== 'true') return undefined;
	const raw = request.headers.get('X-Debug-Now');
	if (!raw) return undefined;
	const t = new Date(raw);
	return Number.isNaN(t.getTime()) ? undefined : t;
}
