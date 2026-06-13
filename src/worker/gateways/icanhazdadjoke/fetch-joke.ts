// Public contract for the icanhazdadjoke gateway: request, response, and error surface.

// Expressed as a function type so the contract lives here and the implementation
// is compiler-bound to it.
export type FetchJoke = (req: FetchJokeRequest) => Promise<FetchJokeResponse>;

export type FetchJokeRequest = {
  fetch: typeof fetch;
};

export type FetchJokeResponse = { ok: true; data: Joke } | { ok: false; error: JokeGatewayError };

export type Joke = {
  id: string;
  text: string;
};

export type JokeGatewayError = { kind: 'upstream'; status: number; detail?: string } | { kind: 'network'; detail?: string };

export { fetchJokeImplementation as fetchJoke } from './fetch-joke-impl';
