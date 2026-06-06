# ADR-0013: Conditional frame requests — ETag / unchanged-frame skip

- **Status:** Accepted
- **Date:** 2026-06-07
- **Deciders:** Philip Fourie
- **Wire specification:** [`../api/openapi.yaml`](../api/openapi.yaml) — the authoritative *what* (the `If-None-Match` / `ETag` headers, the `304` response shape). This ADR is the *why*.
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.
- **Related:** [#71](https://github.com/philipf/gotta-go/issues/71) (this slice — contract + ADR), [#72](https://github.com/philipf/gotta-go/issues/72) (two-phase registry contract, the enabler), [#73](https://github.com/philipf/gotta-go/issues/73) (Worker emits `ETag`/`304`), [#74](https://github.com/philipf/gotta-go/issues/74) (firmware skip-flush), [#75](https://github.com/philipf/gotta-go/issues/75) (`dual_month_calendar` layout), [#76](https://github.com/philipf/gotta-go/issues/76) (`daytime_calendar` phase), [ADR-0003](0003-radiator-worker-contract.md) (the contract this amends), [ADR-0004](0004-diagnostics-view-content-negotiation.md) (content negotiation — the diagnostics variants this excludes).

> **Note on numbering.** Issues #71–#76 refer to this decision as "ADR-0012"; that number was taken by [ADR-0012 (host-native tests)](0012-radiator-host-native-tests.md) before this document landed. This is the ADR those issues mean.

## Context

An e-ink **panel** flushes — visibly flashes — on every frame write. [ADR-0003](0003-radiator-worker-contract.md)'s firmware loop flushes on every `200`, which is correct for transit content (the **marker** moves, **Leave In** counts down — every wake cycle's frame is genuinely new) but wrong for content that barely changes. The office radiator made this concrete: it ran an all-day clock, so staying *accurate* meant refreshing often, and refreshing often meant a panel flash pulling the eye every few minutes. The clock is being replaced by the `dual_month_calendar` **layout** ([#75](https://github.com/philipf/gotta-go/issues/75)) precisely because a calendar's content changes at most once a day — but under the current contract the panel would still flash on every wake, redrawing an identical frame.

The contract has no way for the Worker to say "the frame you are showing is still correct — do not redraw." This ADR adds one, using standard HTTP conditional requests, and amends ADR-0003's firmware-behaviour table accordingly. It is the contract-and-docs slice only; the Worker implementation lands in [#73](https://github.com/philipf/gotta-go/issues/73) and the firmware in [#74](https://github.com/philipf/gotta-go/issues/74), both blocked by this one.

One piece of groundwork makes the design cheap: the two-phase registry contract ([#72](https://github.com/philipf/gotta-go/issues/72)) splits every layout into `buildViewModel(ctx)` and `render(vm, ctx)`. The **view model** therefore exists *before* the Satori → resvg → BMP pipeline runs — which is what lets the Worker answer "unchanged" without rendering anything.

## Decision

### Standard HTTP conditional requests: `ETag` / `If-None-Match` / `304`

The Worker sets a **weak `ETag`** on every `200` frame response. The radiator stores it and sends it back as `If-None-Match` on its next wake. When the ETag still matches, the Worker returns **`304 Not Modified`** — no body, no render — and **still sets `X-Sleep-Seconds`** (sleep authority is on every response, per ADR-0003; a `304` is no exception). The firmware skips the panel flush and deep-sleeps. The panel keeps its frame untouched: no flash, no eye-pull.

Rejected alternatives:

- **A custom `X-Frame-Hash` header pair.** Reinvents `ETag`/`If-None-Match` with none of the tooling benefits — `curl`, HTTP caches, and every HTTP library already understand the standard mechanism.
- **`Last-Modified`/`If-Modified-Since`.** The Worker doesn't track a modification *time* — frame identity is a function of content inputs, not a timestamp. A hash is the natural validator.
- **Worker-side only (compare rendered bytes, suppress identical frames).** The Worker cannot know what the panel is showing; only the radiator holds that state. The validator must round-trip through the client, which is exactly what `ETag` is for.

### The ETag is derived from content inputs, not rendered bytes

The ETag is a hash of the layout's serialised **view model** (the `toJsonView` output — the fields that drive pixels) plus a per-layout **`LAYOUT_VERSION`** constant. It is *not* a hash of the rendered BMP. Two consequences, both deliberate:

- **A `304` costs no render.** `buildViewModel` runs (it must — the answer to "did the content change?" lives there), the hash is compared, and on a match the entire Satori → resvg → BMP pipeline is skipped. For the calendar that turns every daytime wake except the midnight rollover into date math plus a hash.
- **It is a *weak* validator (`W/"…"`), honestly.** RFC 9110 weak semantics promise semantic equivalence, not byte identity — which is exactly what "same view model, same layout version" guarantees. We never compare rendered bytes, so we never claim byte identity.

Two scoping rules keep the hash honest:

- **Observability fields are excluded.** The envelope's `server_time` changes on every request; hashing it would mean no `304` ever fires. The hash covers the layout's `toJsonView` fields only — the values Satori is fed — not the envelope's diagnostics mirror.
- **`LAYOUT_VERSION` busts the cache on code changes.** A layout tweak (new cell styling, moved header) changes the pixels *without* changing the view model. Bumping the layout's `LAYOUT_VERSION` constant in the same commit changes the ETag, so every radiator redraws on its next wake. Forgetting the bump is the failure mode to watch in review: the symptom is a visual change that deployed but never appears on panels.

Layouts whose view model changes every wake (`priority_split` — the marker moves; `minimal_clock` — the time string) simply never match, and keep their flush-every-wake behaviour with no special-casing. The mechanism is uniform; the *content* decides the cadence.

### Only the `image/bmp` path participates

The JSON and SVG **diagnostics view** variants (ADR-0004) always return `200`, even when the request carries a matching `If-None-Match`. A human running `curl` against the diagnostics surface came to *see the data*; answering `304` would hide exactly what they asked for. The radiator's path is the only one with a panel to protect.

### Firmware behaviour: the `304` row

This **amends ADR-0003's firmware-behaviour table** (in the amends-a-part-of-0003 style of ADR-0010/0011) with one new row:

| Response received | Firmware action |
|---|---|
| `304 Not Modified` with `X-Sleep-Seconds` | Do not touch panel (it already shows this frame). Keep the stored ETag. Deep-sleep for `X-Sleep-Seconds`, or the firmware fallback (300 s) if the header is absent |

And three ETag-handling rules around the existing rows:

1. **Send `If-None-Match` on every wake when an ETag is stored.** No stored ETag (first boot, post-re-flash, cleared) → no header → the Worker answers `200` as today.
2. **Store a new ETag only after a successfully flushed `200`.** A `200` whose body fails decompression/parse does *not* update the stored ETag — the panel still shows the old frame, so the old ETag is still the truth. (Responses without an `ETag` header — e.g. a Worker predating #73 — clear the stored value.)
3. **Clear the stored ETag whenever the panel is drawn with anything other than a frame** — i.e. on rendering the error screen (ADR-0011). The stored ETag asserts "the panel shows the frame this ETag identifies"; once an error screen is up, that is false, and a subsequent `304` would strand the error screen on the panel forever. Clearing it forces a `200` (full redraw) on the next successful wake.

ETag storage must survive deep sleep (RTC memory) but need not survive power loss: losing it merely costs one redundant `200` redraw of an identical frame — safe, just one extra flash. Persistence mechanics are firmware implementation detail ([#74](https://github.com/philipf/gotta-go/issues/74)).

### What a `304` carries

Per RFC 9110 §15.4.5 a `304` repeats the headers a `200` would have carried: the `ETag` itself, plus `X-Sleep-Seconds`, `X-Server-Time`, and `X-Profile-Phase`. The firmware only reads `X-Sleep-Seconds` (it keeps its stored ETag — rule 2 above says new ETags are stored only on a `200`); the rest exist for humans running `curl`, as ever. No body, no `Content-Type`, no `Content-Encoding`.

The conditional check sits *after* auth, slug resolution, phase resolution, and `buildViewModel` — a `304` only ever replaces a would-be `200`. Every error path is untouched: a non-2xx returns its `problem+json` document (ADR-0011) regardless of any `If-None-Match` on the request.

## Why this preserves "Dumb Radiator, Smart Edge"

The firmware gains no judgement calls. It echoes an opaque string it was handed, and the status code still collapses to a mechanical decision — now ternary instead of binary: `200` → flush, `304` → skip, non-2xx → error screen. All *thinking* (what changed, whether a redraw is warranted, what the validator covers) stays on the Worker. The stored ETag is the radiator's second piece of persistent state after the slug — an opaque token it never inspects.

## ADR-0003 rules this amends

| ADR-0003 rule | Amendment |
|---|---|
| Firmware-behaviour table (§Radiator firmware behaviour) — no `304` row | Gains the `304` row and the three ETag-handling rules above. The existing rows are unchanged. |
| "The radiator parses exactly two response artefacts" (§Why this preserves "Dumb Radiator…") | Three: the gzipped BMP body, the integer `X-Sleep-Seconds`, and the opaque `ETag` string (stored and echoed, never inspected). |
| "All status codes collapse to a binary firmware decision: 'got a frame to flush? yes/no'" | Ternary: flush (`200`), skip (`304`), error screen (non-2xx, per ADR-0011). |

Everything else in ADR-0003 — endpoint shape, auth/identity, sleep authority and bounds, the idle profile, the `X-Radiator-*` namespace, the 300 s fallback — stands unchanged.

## Consequences

### Positive

- **No more redraw-vs-accuracy tradeoff for slow content.** The `daytime_calendar` phase ([#76](https://github.com/philipf/gotta-go/issues/76)) can wake on the 4 h cap all day; the only visible flash is the daily date rollover.
- **`304`s are nearly free on the Worker.** Date math plus a hash; the render pipeline — the expensive part of a frame response — never runs.
- **Standard mechanism, standard tooling.** `curl -H 'If-None-Match: …'` exercises the path; no bespoke protocol to document beyond this ADR.
- **Uniform across layouts.** Fast-changing layouts opt out by *content*, not by configuration — there is no per-layout participation flag to keep in sync.

### Negative / follow-ups

- **A second piece of radiator state.** The stored ETag adds RTC-memory state and three handling rules to the firmware. The rules are mechanical, but rule 3 (clear on error screen) is the kind of subtle invariant that needs a host-native test (ADR-0012) rather than trust.
- **`LAYOUT_VERSION` discipline is manual.** A visual change without a version bump silently never reaches panels that keep matching. Mitigated by review convention; if it bites, a build-time hash of the layout source could replace the constant.
- **The view-model serialisation becomes ETag-significant.** Reordering `toJsonView` fields or changing a format string changes the hash and forces a one-time fleet redraw. Harmless (one extra flash), but worth knowing when refactoring.
- **No conditional support on diagnostics variants.** Deliberate (see above), but it means the BMP path's `304` behaviour cannot be fully exercised through the JSON view — Worker tests must hit the `image/bmp` path.

## Glossary impact

The following terms are added to [`../glossary.md`](../glossary.md):

| Term | Section | Action |
|---|---|---|
| **Conditional frame request** | §8 (Radiator ↔ Worker contract) | **Add.** A frame request carrying `If-None-Match` with the radiator's stored **ETag**; answered `304` when the content inputs are unchanged. `image/bmp` path only. |
| **ETag** | §8 | **Add.** The weak validator (`W/"…"`) derived from the layout's serialised view model + `LAYOUT_VERSION` — content inputs, not rendered bytes. |
| **Unchanged-frame skip** | §8 | **Add.** The firmware behaviour on `304`: parse `X-Sleep-Seconds`, do not touch the panel, keep the stored ETag, deep-sleep. |
| **`dual_month_calendar`** | §2 (Layout) | **Add** to the layout list: current-date header + this-month and next-month grids, Monday-start, today inverted ([#75](https://github.com/philipf/gotta-go/issues/75)). |
| **`daytime_calendar`** | §7 (Profiles & modes) | **Add.** The office radiator's full-day phase running `dual_month_calendar` at the 4 h cadence cap; replaces the all-day clock ([#76](https://github.com/philipf/gotta-go/issues/76)). |

## Verification

When #73 (Worker) and #74 (firmware) implement this contract, the following must hold:

1. `GET /v1/frame` (BMP path, no `If-None-Match`) → `200` with a weak `ETag` header (`W/"…"`).
2. Repeat with `If-None-Match: <that ETag>` and unchanged content → `304`, empty body, no `Content-Type`/`Content-Encoding`, `X-Sleep-Seconds` and `ETag` present.
3. Same conditional request with `Accept: application/json` or `Accept: image/svg+xml` → `200` with the full diagnostics body (diagnostics never `304`).
4. Change the view model (cross midnight for the calendar) → the same `If-None-Match` now returns `200` with a *new* `ETag`.
5. Bump the layout's `LAYOUT_VERSION` only → the same `If-None-Match` returns `200` (code changes bust the validator).
6. Any error path (bad token, unknown slug, forced Metlink failure) with a matching `If-None-Match` → the normal `problem+json` response, never a `304`.
7. Firmware: on `304`, the panel is not touched and the radiator deep-sleeps for `X-Sleep-Seconds`; after rendering an error screen, the next request carries no `If-None-Match`.
8. The OpenAPI spec lints clean under `redocly lint` (or an equivalent OpenAPI 3.1 validator).

## References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) §8.8.3 (`ETag`, weak validators), §13.1.2 (`If-None-Match`), §15.4.5 (`304 Not Modified`).
- [OpenAPI spec](../api/openapi.yaml) — authoritative wire contract.
- [Glossary](../glossary.md) §2 (layout), §7 (profiles), §8 (radiator ↔ worker contract).
- [ADR-0003](0003-radiator-worker-contract.md) — the contract this amends.
- [ADR-0004](0004-diagnostics-view-content-negotiation.md) — the diagnostics variants excluded from conditional handling.
- [ADR-0011](0011-error-contract-problem-details.md) — the error screen whose render clears the stored ETag.
- [gencal](https://github.com/philipf/gencal) — reference spec for the dual-month calendar rendering.
- Related issues: [#71](https://github.com/philipf/gotta-go/issues/71) (this slice), [#72](https://github.com/philipf/gotta-go/issues/72) (two-phase registry), [#73](https://github.com/philipf/gotta-go/issues/73) (Worker), [#74](https://github.com/philipf/gotta-go/issues/74) (firmware), [#75](https://github.com/philipf/gotta-go/issues/75) (layout), [#76](https://github.com/philipf/gotta-go/issues/76) (phase config).
