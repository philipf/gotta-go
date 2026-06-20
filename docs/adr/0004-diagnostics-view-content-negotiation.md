# ADR-0004: Diagnostics view via `Accept`-based content negotiation

- **Status:** Accepted (implementation deferred)
- **Date:** 2026-05-23
- **Deciders:** Philip Fourie
- **Wire specification:** [`../api/openapi.yaml`](../api/openapi.yaml) — to be extended when the implementation issues land.
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.
- **Implementation tracking:** [#19](https://github.com/philipf/gotta-go/issues/19) (JSON view-model), [#20](https://github.com/philipf/gotta-go/issues/20) (Satori SVG).

## Context

End-to-end testing of the Worker against the contract from [ADR-0003](0003-radiator-worker-contract.md) is hard today: the only artefact the Worker emits is a 1-bit BMP. Tests must either pixel-diff against a reference image — brittle against font hinting changes and trivial layout drift, and unhelpful when something breaks because the pixels do not explain *why* — or they must duplicate the Worker's logic in test code to predict what the BMP should contain, defeating the point of an end-to-end test.

The Worker internally computes a structured **view model** (active **profile phase**, **layout**, per-column **transit target** fields, marker state, observability values) before handing it to Satori, then takes the intermediate Satori SVG and encodes it to BMP. Two intermediate artefacts already exist and currently leave no trace in the response.

This ADR decides how to expose those artefacts without disturbing the radiator's request path or the contract from ADR-0003.

## Decision

Extend `/v1/frame` with HTTP content negotiation via `Accept`:

| `Accept` header             | Response                                                                |
|-----------------------------|-------------------------------------------------------------------------|
| `image/bmp` *(or absent)*   | Current behaviour — gzipped 1-bit 960×540 BMP. Unchanged.               |
| `application/json`          | JSON envelope describing the view model fed to Satori for this request. |
| `image/svg+xml`             | The intermediate Satori SVG, gzipped per ADR-0001.                      |

Query params on the JSON variant:

- `?include_bmp=1` — adds `frame_bmp_base64` to the envelope, decoding to the byte-identical BMP a sibling `Accept: image/bmp` call would have returned. Default off.

Auth, slug resolution, sleep-duration logic, error semantics, and observability response headers are unchanged across all three Accept variants — only the response body shape and `Content-Type` differ. The full schema for the JSON envelope and the SVG variant will be added to `docs/api/openapi.yaml` as part of the implementation issues; this ADR fixes the mechanism and the rationale, not the field names.

### Why content negotiation, not a sibling endpoint

- **Atomic per call.** The JSON envelope describes *this exact* render — the same view model that produced the BMP fingerprint we would also be inspecting. A sibling endpoint (`/v1/frame/debug` returning JSON, separate request) would let server time, the active profile phase, the live Metlink response, or any other server-side state flip between the two requests, so the JSON could describe a *different* render than the BMP did. That race only matters at phase boundaries and around upstream changes, but those are exactly the moments tests care about.
- **Standards-compliant.** HTTP already specifies this mechanism. No bespoke header or magic query param to document.
- **Single URL, single doc, single auth path.** The OpenAPI extension is local to one operation. No new endpoint to wire up, no new code path through the Worker's auth shell.
- **Radiator path is unchanged.** Firmware sends `Accept: image/bmp` (or omits `Accept` entirely) and is oblivious to the diagnostic surface — the "Dumb Radiator, Smart Edge" invariant from PRD §8 is preserved verbatim.

Rejected alternatives:

- **JSON in a response header (base64).** Cloudflare's per-header size budget is ~16 KB total; the view model could exceed that for a `priority_split` with two columns and rich service detail. Also unreadable from `curl` without a decode step.
- **`multipart/mixed` response.** Standards-correct, ergonomically miserable. Test code in any language we are likely to use would have to pull in a multipart parser to extract one JSON part and one binary part. Ecosystem support is patchy.
- **Sibling endpoint `/v1/frame/debug` returning JSON.** Loses atomicity (see above). Would need a deterministic-clock query param to recover atomicity, which we are explicitly rejecting below.

### Why `?include_bmp=1` opt-in, not always-on

- JSON envelopes stay small for the dominant use case — a test asserts on `profile_phase`, on `columns[0].catchable_service.leave_in_mins`, etc., and does not need the BMP at all.
- Tests that *do* want to round-trip the BMP (regression hash, fixture snapshot) can request it explicitly with one extra character on the URL.
- Bandwidth and parse cost matter once we have a CI matrix exercising many scenarios.

### Why no deterministic `?at=<iso8601>` clock

Tempting, because it would make tests fully hermetic — a snapshot at 06:48 in CI would mean exactly the same thing every time. We are rejecting it for one concrete reason: the Metlink `/stop-predictions` endpoint ([reference](../reference/metlink-stop-predictions.md)) does not provide historic data. We cannot replay yesterday's 06:48 prediction set today. A deterministic `?at` without deterministic Metlink data buys us only half-hermetic tests, which would mislead — a green test in CI would not guarantee anything about the same `?at` value tomorrow.

Revisit if we add a recorded-fixture playback mode for Metlink. Until then, tests remain time-of-day-dependent, which is acceptable for the kind of assertions this surface enables ("the active phase is `morning_commute` and the leave_in_mins is non-negative") vs. exact-value assertions.

### Why the Satori SVG too

- **Debugging cost is near zero.** The Worker already produces the SVG en route to the BMP. Surfacing it is a serialiser, not new render logic.
- **Browser debugging.** A human can open `curl -H 'Accept: image/svg+xml' --compressed /v1/frame -o frame.svg && xdg-open frame.svg` and visually inspect typography decisions, alignment, and layout maths without flashing firmware or running the BMP encoder in their head.
- **Future-proofing.** A future radiator with a different panel resolution (smaller bedside unit, larger fridge unit) can reuse the upstream view-model + Satori pipeline and have a separate Worker code path rasterise the SVG to its own target dimensions. The pipeline stays single-source; only the final encoder changes.

### Why no new auth, no new secret

The diagnostic surface is gated by the same shared token (the `Authorization: Bearer` credential) already required for the BMP. Anyone with the token already receives the rendered BMP; the JSON view is a strict subset of what they could derive by parsing the BMP themselves (with more effort). No new attack surface, no new secret to rotate.

**This preserves "Dumb Radiator, Smart Edge."** The radiator never sends `Accept: application/json` or `image/svg+xml` — its firmware path is untouched. The diagnostic surface is server-side serialisation of the same view-model type already fed to Satori; no new firmware code, no parallel source of truth.

## Consequences

### Positive

- **Tests can assert semantically.** "At time T, slug X, the active phase is `morning_commute` and `columns[0].catchable_service.leave_in_mins == 7`" — meaningful failure messages, root-cause-friendly.
- **Visual debugging without firmware.** Open the SVG in a browser; no LilyGO panel, no flashing.
- **Future-proof for different panel sizes.** The upstream pipeline stays single-source.
- **No new auth surface.** Same shared token (`Authorization: Bearer`), same request path, same observability headers.
- **Standards-compliant.** Anyone familiar with HTTP can predict the behaviour without reading our docs.

### Negative / follow-ups

- **Worker response handler must branch on `Accept`.** Small extra surface; mitigated by treating the JSON path as a serialiser of an existing internal type.
- **OpenAPI spec gains response variants.** Lint must keep passing after the implementation issues land.
- **JSON envelope schema needs maintenance** as the view model evolves. Mitigated by sharing the type definition with the renderer rather than maintaining a parallel one.
- **Implementation deferred.** Tracked separately as issues #19 (JSON) and #20 (SVG). This ADR fixes the mechanism so we can refer to it in design discussions before the code lands.

## References

- [ADR-0001](0001-frame-transport-compression.md) — `Content-Encoding: gzip` on the frame body (applies to the SVG variant too)
- [Metlink reference](../reference/metlink-stop-predictions.md) — explains why historic Metlink data is not cheaply available (cited in the rejection of `?at=`)
- [ADR-0003](0003-radiator-worker-contract.md) — the base contract this extends
- [`../api/openapi.yaml`](../api/openapi.yaml) — current wire spec; will be extended on implementation
- Issue [#19](https://github.com/philipf/gotta-go/issues/19) — implementation: JSON view-model variant
- Issue [#20](https://github.com/philipf/gotta-go/issues/20) — implementation: Satori SVG variant
