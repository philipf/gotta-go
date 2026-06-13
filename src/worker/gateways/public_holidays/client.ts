// KV transport for public_holidays — the one place that knows the KV key and
// issues the read. Returns the raw stored value (read as JSON, hence unknown);
// validation and wire→domain mapping live in the impl and mapper.

export type ClientRequest = {
  kv: KVNamespace;
};

// Mirrors KV_KEY in src/tools/fetch-nz-holidays.ts — that tool is a standalone
// package, so the key is redeclared here rather than imported across the package
// boundary.
const KV_KEY = 'public-holidays:NZ:current';

export function readHolidaysPayload(req: ClientRequest): Promise<unknown> {
  return req.kv.get(KV_KEY, 'json');
}
