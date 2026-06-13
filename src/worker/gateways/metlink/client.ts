// Thin HTTP layer for /stop-predictions; omits service_id from the query string
// because it is silently ignored upstream and filtering happens client-side.

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
