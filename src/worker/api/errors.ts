// Error response shapers per ADR-0003.
// Bodies are short lowercase strings; the radiator firmware ignores them
// entirely — the status code drives behaviour. Sleep-seconds values come
// straight from the OpenAPI spec.

const PLAIN_TEXT = 'text/plain; charset=utf-8';

const AUTH_SLEEP = '3600'; // 1h on auth/slug errors per ADR-0003

export function unauthorized(): Response {
	return new Response('unauthorized', {
		status: 401,
		headers: {
			'Content-Type': PLAIN_TEXT,
			'X-Sleep-Seconds': AUTH_SLEEP,
			'X-Profile-Phase': 'none',
		},
	});
}

export function unknownRadiator(): Response {
	return new Response('unknown radiator', {
		status: 404,
		headers: {
			'Content-Type': PLAIN_TEXT,
			'X-Sleep-Seconds': AUTH_SLEEP,
			'X-Profile-Phase': 'none',
		},
	});
}

// Router-level 404 for an unknown path. The radiator firmware only ever hits
// /v1/frame, so this branch is a developer/curl condition — no contract
// headers, no sleep instruction; firmware falls back to its built-in default
// if it ever hits this.
export function notFound(): Response {
	return new Response('not found', {
		status: 404,
		headers: { 'Content-Type': PLAIN_TEXT },
	});
}
