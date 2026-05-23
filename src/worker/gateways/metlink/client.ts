// Thin HTTP layer for /stop-predictions. Builds URL + headers, calls the
// injected fetch, returns the raw Response. service_id is deliberately
// omitted from the query string (silently ignored upstream per ADR-0002);
// filtering happens client-side in mapper.ts.

const BASE_URL = 'https://api.opendata.metlink.org.nz/v1';

export type ClientRequest = {
	fetch: typeof fetch;
	apiKey: string;
	stopId: string;
	limit: number;
};

export function fetchStopPredictions(req: ClientRequest): Promise<Response> {
	const url = `${BASE_URL}/stop-predictions?stop_id=${encodeURIComponent(req.stopId)}&limit=${req.limit}`;
	return req.fetch(url, {
		headers: { 'x-api-key': req.apiKey },
	});
}
