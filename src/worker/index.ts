// Cloudflare Worker entry: delegates to the API router with a fresh now Date injected at
// the edge; X-Debug-Now overrides it in dev for time-of-day phase resolution.

import { route } from './api/router';
import { resolveDevNow } from './debug/dev-time';

export default {
	async fetch(request, env): Promise<Response> {
		const now = resolveDevNow(request, env) ?? new Date();
		return route(request, env, now);
	},
} satisfies ExportedHandler<Env>;
