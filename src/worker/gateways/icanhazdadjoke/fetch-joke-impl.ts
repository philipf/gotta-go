// icanhazdadjoke orchestration: composes client and mapper; error surface is coarse by design —
// idle content maps every failure to network or upstream.

import type { FetchJoke } from './fetch-joke';
import { fetchRandomJoke } from './client';
import { toJoke } from './mapper';
import type { WireJoke } from './wire-types';
import { snippet } from '../../shared/errors';

export const fetchJokeImplementation: FetchJoke = async (req) => {
  let response: Response;
  try {
    response = await fetchRandomJoke({ fetch: req.fetch });
  } catch (err) {
    // Preserve the cause: the gateway is side-effect-free (ADR-0005), so the
    // returned error value is its only channel to the structured log (#55).
    return { ok: false, error: { kind: 'network', detail: String(err) } };
  }

  if (!response.ok) {
    const detail = snippet(await response.text());
    return { ok: false, error: { kind: 'upstream', status: response.status, detail } };
  }

  let json: WireJoke;
  try {
    json = (await response.json()) as WireJoke;
  } catch (err) {
    return { ok: false, error: { kind: 'upstream', status: response.status, detail: String(err) } };
  }

  // A 2xx with no usable joke text is as useless as a 5xx — treat it as upstream
  // so the caller renders the error path, not an empty frame.
  if (typeof json.joke !== 'string' || json.joke.trim() === '') {
    return { ok: false, error: { kind: 'upstream', status: response.status } };
  }

  return { ok: true, data: toJoke(json) };
};
