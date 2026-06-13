// Weak ETag computation and If-None-Match comparison for conditional frame requests.
// FNV-1a 64-bit: synchronous (no crypto.subtle await on the hot path), tiny, collision-resistant.

// Derives the weak ETag for a frame from its content inputs: the serialised
// JSON view (observability fields like server_time are already excluded —
// the envelope adds those, the layout's toJsonView does not) plus the layout
// version, so a visual-only code change busts every cached validator.
// Serialisation order is ETag-significant (ADR-0013 §Consequences): reordering
// toJsonView fields forces a one-time fleet redraw — harmless, but known.
export function weakEtag(view: Record<string, unknown>, layoutVersion: number): string {
  return `W/"${fnv1a64(`${layoutVersion}:${JSON.stringify(view)}`)}"`;
}

// RFC 9110 §8.8.3.2 weak comparison: two entity tags match if their opaque
// tags are identical, ignoring any `W/` prefix on either side. The firmware
// echoes the stored ETag verbatim so an exact compare would do, but a human
// replaying with curl may drop the weak prefix — tolerate it. Handles the
// comma-separated If-None-Match list form; `*` is deliberately not special-
// cased (the radiator never sends it, and treating it as a literal non-match
// fails safe: a 200 redraw).
export function ifNoneMatchSatisfied(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const opaque = stripWeak(etag);
  return ifNoneMatch.split(',').some((candidate) => stripWeak(candidate.trim()) === opaque);
}

// FNV-1a 64-bit over the UTF-16 code units of the input. BigInt keeps the
// multiply exact; the mask folds back to 64 bits each round.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function stripWeak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}
