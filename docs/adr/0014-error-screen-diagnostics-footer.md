# ADR-0014: Error-screen diagnostics footer (and deferred typography)

- **Status:** Accepted
- **Date:** 2026-06-27
- **Deciders:** Philip Fourie
- **Scope:** Firmware-only — what the radiator *draws* on the error screen. No wire change: every field shown is either already on the response (`X-Server-Time`, `X-Sleep-Seconds`) or compile-time local (slug, SSID, firmware version).
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.
- **Related:** [#61](https://github.com/philipf/gotta-go/issues/61) (this slice — diagnostics + cosmetic), [#60](https://github.com/philipf/gotta-go/issues/60) (the minimal error screen this builds on), [ADR-0011](0011-error-contract-problem-details.md) (the error contract + the generic-screen decision), [#66](https://github.com/philipf/gotta-go/issues/66) (Wi-Fi-down arm) and [#129](https://github.com/philipf/gotta-go/issues/129) (transport-failure arm) — both reuse the renderer, [ADR-0003](0003-radiator-worker-contract.md) (`X-Sleep-Seconds` sleep authority).

## Context

[#60](https://github.com/philipf/gotta-go/issues/60) shipped a deliberately minimal error screen ([ADR-0011](0011-error-contract-problem-details.md) Decision 8): a problem document's `title` as the heading and `detail` as the body, drawn in the one bundled FiraSans face. In use ([#61](https://github.com/philipf/gotta-go/issues/61)) it proved too bare. The panel is glanceable but answers none of the questions you actually have when you walk past a radiator showing an error: **when** did it fail, **when** will it retry, and **which** device / network / firmware is this? Without those, an error screen is only marginally better than the silently-held stale frame it replaced.

#61 collected raw improvements in three buckets: **diagnostics** (timestamp + next-check + slug/SSID/version), **typography** (bold title, smaller body), and **cosmetic** (glyph, separators, layout). This ADR records what shipped and, just as importantly, what was deferred and why.

## Decision

### A diagnostics footer, sourced locally and passed in

The error screen gains a footer carrying five fields:

| Field | Source | Notes |
|---|---|---|
| **slug** | `RADIATOR_SLUG` (compile-time) | which radiator |
| **firmware version** | `FIRMWARE_VERSION` (compile-time) | which build — see below |
| **SSID** | `WIFI_SSID` / the attempted AP | which network |
| **error time** | `X-Server-Time` response header | when it failed |
| **next check** | `chooseSleep(...)` — the same decision the sleep policy uses | when it retries |

The fields are carried in an `ErrorDiag` struct **passed into** `renderErrorScreen()`, never reached out for. This preserves the [ADR-0011](0011-error-contract-problem-details.md) Decision 10 contract that the renderer is a neutral primitive: the Worker-error arm fills `ErrorDiag` from the HTTP response, while the **Wi-Fi-down ([#66](https://github.com/philipf/gotta-go/issues/66))** and **transport-failure ([#129](https://github.com/philipf/gotta-go/issues/129))** arms — which have no response — fill the same struct from local sources. One renderer, three callers, no coupling to an HTTP object.

The **next-check** value is resolved through the same `chooseSleep()` the sleep policy keys on, so the panel's "next check" can never drift from the actual deep-sleep duration.

### Error time is displayed as UTC, sliced — no on-device timezone

`X-Server-Time` is an ISO-8601 UTC instant (`2026-05-23T06:48:12.000Z`). The footer shows `2026-05-23 06:48 UTC` by **slicing to minute precision** (drop seconds/millis, `T`→space, stamp `UTC`). We deliberately do **not** convert to local time: the radiator carries no timezone database and runs no NTP, and an honest UTC stamp beats a wrong local one or dragging in `tz` data for a debug aid. Minute precision is all a glanceable panel needs.

### No server time → omit the time clause, keep the next-check

A transport or Wi-Fi failure returns no response, so there is no `X-Server-Time` (and no `X-Sleep-Seconds`). On those arms the footer **omits the error-time clause** entirely rather than printing "unknown", and the next-check falls to the firmware fallback (~5 min) the same way the sleep policy's does. The renderer drops any footer clause whose source field is empty, so this needs no special-casing at the call site.

### Firmware version lives in a tracked `version.h`

The version is a **build-level** constant (every radiator on the same firmware reports the same value), not a per-deployment one, so it lives in a tracked `src/radiator/version.h` — **not** the gitignored, per-deployment `settings.h`. It is bumped by hand on release and also logged in the wake banner. We rejected build-time `git describe` injection: it would add an Arduino-unfriendly codegen step to `flash.sh` for little gain on a hobby cadence.

### Cosmetic polish stays within the bundled font

A warning glyph (`❗`, U+2757 — in FiraSans's dingbat interval) precedes the title, and separator rules (runs of `─`, U+2500 — in its box-drawing interval) divide heading / body / footer. Both reuse the **already-bundled** FiraSans; no new font header is added for cosmetics. The footer is a single line — `slug | version | ssid | [error time |] next-check` — joined by spaced pipes (` | `) to save vertical space; the spaces let `wrapText` break between fields rather than clip a too-long run at 50 px (the deeper fix is the deferred smaller font).

### Typography is deferred

Items 2–3 (bold title, smaller body) are **not** in this slice. The library bundles exactly one FiraSans face at one weight and one 50 px size; a true bold heading and a smaller body each need a `GFXfont` header generated with the library's `fontconvert.py` (freetype-py + the FiraSans Regular/Bold TTFs) and **vendored into the repo** — the existing 50 px face is ~780 KB. That is a separate, cost-bearing decision (tooling, downloads, ~1 MB of generated headers) and is split into a follow-up issue, which should also carry the clean thin-rule separators a framebuffer renderer would enable. The honest consequence below is acknowledged.

## Consequences

- **Positive.** An error screen now says when it broke, when it will retry, and which device/network/firmware it is — turning a "something's wrong" panel into a diagnosable one — without any wire change and without bundling a font.
- **Negative — vertical crowding.** At 50 px, a long `detail` plus the footer can exceed the 540 px panel; the overflow is clipped (ADR-0011 Decision 6). This is the precise pressure that motivates the deferred **smaller-body** typography work; it is a known, accepted limitation of this slice, not a regression.
- The `formatServerTime` / `formatNextCheck` / `buildDiagFooter` helpers are pure and host-tested (ADR-0012); the draw path stays the device-only NULL-framebuffer idiom.
