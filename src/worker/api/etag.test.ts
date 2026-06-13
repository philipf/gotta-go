import { describe, it, expect } from 'vitest';
import { ifNoneMatchSatisfied, weakEtag } from './etag';

// The weak ETag validator (ADR-0013 / #73): content-input equivalence, not
// byte identity. The hash algorithm is opaque to consumers — these tests pin
// the contract shape and the change-detection semantics, not FNV-1a itself.
describe('api.etag - weakEtag', () => {
  const view = { slug: 'office', months: ['June 2026', 'July 2026'], today: 7 };

  it('produces an RFC 9110 weak entity tag: W/"<16 hex chars>"', () => {
    expect(weakEtag(view, 1)).toMatch(/^W\/"[0-9a-f]{16}"$/);
  });

  it('is deterministic for an identical view model + layout version', () => {
    expect(weakEtag(view, 1)).toBe(weakEtag({ ...view }, 1));
  });

  it('changes when any view-model field changes (the midnight rollover)', () => {
    expect(weakEtag({ ...view, today: 8 }, 1)).not.toBe(weakEtag(view, 1));
  });

  it('changes when LAYOUT_VERSION is bumped for otherwise-identical content', () => {
    expect(weakEtag(view, 2)).not.toBe(weakEtag(view, 1));
  });
});

describe('api.etag - ifNoneMatchSatisfied', () => {
  const etag = weakEtag({ a: 1 }, 1);

  it('matches the stored ETag echoed back verbatim (the firmware path)', () => {
    expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
  });

  it('does not match an absent header (first boot / cleared ETag)', () => {
    expect(ifNoneMatchSatisfied(null, etag)).toBe(false);
  });

  it('does not match a stale validator', () => {
    expect(ifNoneMatchSatisfied(weakEtag({ a: 2 }, 1), etag)).toBe(false);
  });

  it('compares weakly per RFC 9110 section 8.8.3.2 - a curl user dropping W/ still matches', () => {
    expect(ifNoneMatchSatisfied(etag.slice(2), etag)).toBe(true);
  });

  it('matches anywhere in a comma-separated If-None-Match list', () => {
    expect(ifNoneMatchSatisfied(`W/"0000000000000000", ${etag}`, etag)).toBe(true);
  });

  it('treats * as a literal non-match (the radiator never sends it; fails safe to a 200)', () => {
    expect(ifNoneMatchSatisfied('*', etag)).toBe(false);
  });
});
