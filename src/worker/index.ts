// Cloudflare Worker entry. Delegates every request to the API router with a
// fresh `now` Date so request-time is injected at the edge, not read inside
// business logic. In dev only, an X-Debug-Now header can override `now` (see
// dev-time.ts) to exercise time-of-day phase resolution; inert in production.

import { route } from './api/router';
import { resolveDevNow } from './dev-time';

export default {
	async fetch(request, env): Promise<Response> {
		const now = resolveDevNow(request, env) ?? new Date();
		return route(request, env, now);
	},
} satisfies ExportedHandler<Env>;
