import { route } from './api/router';

export default {
	async fetch(request, env): Promise<Response> {
		return route(request, env, new Date());
	},
} satisfies ExportedHandler<Env>;
