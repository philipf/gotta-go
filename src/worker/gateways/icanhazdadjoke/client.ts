// Thin HTTP layer for icanhazdadjoke. Hits the random-joke root with
// `Accept: application/json` (their JSON variant → { id, joke, status }) and a
// custom User-Agent carrying the repo URL, as their API etiquette requests.
// Builds the request and calls the injected fetch; returns the raw Response —
// classification and wire→domain mapping live in icanhazdadjoke.ts / mapper.ts.

const BASE_URL = 'https://icanhazdadjoke.com/';

// Their docs ask for a descriptive User-Agent with a contact/repo URL.
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
