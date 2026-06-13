// HTTP transport for icanhazdadjoke — the one place that knows the upstream URL
// and request etiquette, kept out of the orchestrator. `Accept: application/json`
// selects their JSON variant over the default plain-text reply.

const BASE_URL = 'https://icanhazdadjoke.com/';

// Their docs ask for a descriptive User-Agent carrying a contact/repo URL.
const USER_AGENT = 'GottaGo radiator (https://github.com/philipf/gotta-go)';

export type ClientRequest = {
	fetch: typeof fetch;
};

export function fetchRandomJoke(req: ClientRequest): Promise<Response> {
	return req.fetch(BASE_URL, {
		headers: {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
		},
	});
}
