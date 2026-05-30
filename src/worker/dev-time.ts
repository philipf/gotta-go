// Dev-only server-time override. When DEV_TIME_OVERRIDE is enabled (a .dev.vars
// flag, never set in production) and the request carries an X-Debug-Now header
// with a parseable timestamp, that instant replaces the real clock — letting a
// developer drive time-of-day phase resolution (e.g. preview morning_school_run
// outside 07:15–08:30) from curl or the radiator. Returns undefined in every
// other case, so production — where the flag is unset — is wholly unaffected.

export function resolveDevNow(request: Request, env: Env): Date | undefined {
	if (env.DEV_TIME_OVERRIDE !== 'true') return undefined;
	const raw = request.headers.get('X-Debug-Now');
	if (!raw) return undefined;
	const t = new Date(raw);
	return Number.isNaN(t.getTime()) ? undefined : t;
}
