// Shared-token authentication for X-Radiator-Token; returns a flat boolean so the
// deliberately-indistinguishable missing-vs-invalid auth failure is type-enforced.

export type AuthResult = { ok: true } | { ok: false };

// Per the OpenAPI, missing and invalid tokens are deliberately indistinguishable
// — both collapse to a single rejection path. Returning a flat boolean-shaped
// result keeps that property at the type level: callers cannot branch on
// "missing vs invalid" because the information is not exposed.
export function auth(headers: Headers, sharedToken: string): AuthResult {
  const token = headers.get('X-Radiator-Token');
  if (token !== null && token === sharedToken) return { ok: true };
  return { ok: false };
}
