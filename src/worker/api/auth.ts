// Shared-token authentication; returns a flat boolean so the
// deliberately-indistinguishable missing-vs-invalid auth failure is type-enforced.

export type AuthResult = { ok: true } | { ok: false };

// The token is carried in `Authorization: Bearer <token>`. Cloudflare's
// observability pipeline auto-redacts the `Authorization` header to `********`
// in Workers Logs/traces, so the shared secret never lands in logs in cleartext
// (GH #121) — unlike the legacy `X-Radiator-Token`, which CF captured verbatim.
//
// During rollout the worker also accepts the legacy `X-Radiator-Token` so
// in-field radiators that have not yet been reflashed keep working. Once every
// radiator sends `Authorization`, drop the legacy branch and rotate the token.
function extractToken(headers: Headers): string | null {
  const authorization = headers.get('Authorization');
  if (authorization !== null) {
    const match = /^Bearer (.+)$/.exec(authorization);
    if (match !== null) return match[1];
  }
  // Legacy fallback — remove after all radiators send Authorization (GH #121).
  return headers.get('X-Radiator-Token');
}

// Per the OpenAPI, missing and invalid tokens are deliberately indistinguishable
// — both collapse to a single rejection path. Returning a flat boolean-shaped
// result keeps that property at the type level: callers cannot branch on
// "missing vs invalid" because the information is not exposed.
export function auth(headers: Headers, sharedToken: string): AuthResult {
  const token = extractToken(headers);
  if (token !== null && token === sharedToken) return { ok: true };
  return { ok: false };
}
