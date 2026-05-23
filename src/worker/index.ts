// Cloudflare Worker entry. Delegates every request to the API router with a
// fresh `now` Date so request-time is injected at the edge, not read inside
// business logic.

import { route } from './api/router';

export default {
	async fetch(request, env): Promise<Response> {
		return route(request, env, new Date());
	},
} satisfies ExportedHandler<Env>;
