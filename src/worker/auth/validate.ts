// Shared-token validation for the X-Radiator-Token header. Returns a flat
// ok-boolean to keep the OpenAPI's deliberately-indistinguishable
// missing-vs-invalid auth-failure contract enforced at the type level.

export type AuthResult = { ok: true } | { ok: false };

// Per the OpenAPI, missing and invalid tokens are deliberately indistinguishable
// — both collapse to a single rejection path. Returning a flat boolean-shaped
// result keeps that property at the type level: callers cannot branch on
// "missing vs invalid" because the information is not exposed.
// FIX: Not really a validate, this should be authenticate
export function validate(headers: Headers, sharedToken: string): AuthResult {
	const token = headers.get('X-Radiator-Token');
	if (token !== null && token === sharedToken) return { ok: true };
	return { ok: false };
}
