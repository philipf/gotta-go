# ADR-0003: Radiator ↔ Worker HTTP contract

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Philip Fourie
- **Wire specification:** [`../api/openapi.yaml`](../api/openapi.yaml) — the authoritative *what* (paths, headers, status codes, response shapes, value ranges). This ADR is the *why*.
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.

> **Superseded in part by [ADR-0011](0011-error-contract-problem-details.md).** The error model below — specifically the "plain-text bodies, never JSON" rule and the "hold the last frame on any non-2xx" firmware rule — is replaced by the RFC 9457 `problem+json` contract and the firmware error screen. The inline notes mark each superseded passage. Everything else in this ADR (endpoint shape, header-based auth/identity, the `401`-no-oracle and `404`-unknown-slug choices, sleep authority and bounds, the idle profile, the `X-Radiator-*` namespace) still stands. The separate `stale-served`/cache cleanup is tracked apart from ADR-0011.

## Context

PRD v0.4 §8 and glossary §8 sketch the wire surface between the **radiator** and the **Worker** but leave several decisions unmade:

- HTTP method and URL path.
- `Content-Type` of the BMP response body.
- Status codes for missing token, invalid token, and unknown **radiator slug**.
- Whether error responses carry `X-Sleep-Seconds`, and what the radiator does when the Worker is completely unreachable.
- What the Worker returns when server time falls outside every configured **profile phase**.
- Future extensibility for radiator-side telemetry (battery level, hardware identifier, signal strength, firmware version).

Two earlier ADRs already constrain pieces of the contract:

- **ADR-0001** locks `Content-Encoding: gzip` on the BMP body, with `Accept-Encoding: gzip` on the request. It is silent on `Content-Type` and on the URL.
- **ADR-0002** fixes the Metlink upstream behaviour but does not touch the Worker's outward-facing HTTP surface.

This ADR closes the remaining contract gaps before firmware (issue #4) or Worker request-handling code is written, so both sides implement against a single source of truth — captured machine-readably in the OpenAPI spec, and rationalised here.

---

## Decision

The contract is specified in [`../api/openapi.yaml`](../api/openapi.yaml). This section explains the choices behind each part of that spec; for the precise wire format (header names, regex patterns, status-code list, example payloads) read the OpenAPI directly.

### Endpoint shape — `GET /v1/frame`

- **`GET`, no body.** Idempotent. Telemetry rides in request headers, never a body — keeps the firmware on `printf`-grade serialisation with no JSON encoder.
- **Path versioning (`/v1/`).** A future incompatible bump (binary header format, different auth model, …) ships as `/v2/frame` and runs side-by-side with `/v1/frame` long enough to re-flash every radiator. A flag-day cutover would require coordinated re-flash of every unit; the side-by-side path is cheaper at our fleet size. The version segment is also intentionally *expensive* to bump — forcing a re-flash to drop the old version discourages frivolous revisions.
- **`/frame` segment.** Leaves room for sibling paths under the same version (e.g. `/v1/health`) without a refactor.

Rejected: `POST /v1/wake` with a JSON body for telemetry — overkill for a few integer fields, and would force a JSON encoder into firmware.

### Authentication & identification — both in headers

Two pieces of metadata travel on every request: the **shared token** (auth) and the **radiator slug** (identity). They both live in request headers — `X-Radiator-Token` and `X-Radiator-Slug` — rather than in the URL or a request body. Headers keep identity and credentials out of access logs and out of the addressing surface, and they let the radiator add future telemetry headers in the same namespace without changing the URL.

**Why missing token and invalid token are indistinguishable.** Both return `401` with the same body. This removes a token-vs-no-token oracle that a passive observer could otherwise use to probe Worker behaviour, and it collapses two rejection paths into one on the Worker (one auth decision, not two).

**Why unknown slug is `404`, not `401`.** The slug is identification, not authentication. The shared token is authoritative for auth; the slug just selects which radiator's config to apply. Surface area is small (a 5-radiator household) so leaking "this slug isn't registered" carries no real risk, while the readability win in Worker logs and curl output is concrete.

**Why a single shared token instead of per-radiator keys.** Five units, one household operator, infrequent re-flashes. Per-radiator keys would mean five secret-rotation paths and five chances of mis-provisioning a new board. One shared token is one rotation, one secret in the Worker.

### Reserved telemetry namespace — `X-Radiator-*`

All future radiator-side telemetry headers (battery percentage, firmware version, Wi-Fi RSSI, …) MUST use the `X-Radiator-*` prefix. The Worker MUST ignore unknown headers in this namespace.

The point: firmware can add new telemetry without a Worker change and without a contract version bump. The cost is one reserved prefix in the header namespace, which carries no operational burden.

### Sleep authority — `X-Sleep-Seconds`

The Worker dictates the next **sleep duration** on **every response**, including errors. Sleep authority lives entirely on the Worker whenever the radiator can reach it. This lets us slow down radiators during a partial outage (long sleep on 5xx) or speed them up after a deploy (short sleep on 200) without re-flashing.

**Bounds 30 s ≤ n ≤ 14400 s (4 h).**
- The 30 s floor stops a misconfigured Worker from flooding a radiator into a hot loop.
- The 14400 s ceiling forces a wake at least every 4 h so a config bug cannot silently park a radiator forever; it also matches the idle-profile cap (below) so there is one ceiling, not two.

**Firmware fallback constant: 300 s (5 min), compile-time.** Used only when the radiator cannot extract a usable `X-Sleep-Seconds` value — no response, missing header, or value parses outside `[1, 86400]`. The constant lives in firmware rather than config because, by definition, the radiator could not reach the Worker that would have told it otherwise. Five minutes is a balance: short enough to recover quickly when transient network problems clear, long enough not to burn battery during a sustained outage.

### Error model

The status-code split is in the OpenAPI; here are the decisions behind it:

- **No "no active profile phase" error.** When server time falls outside every configured phase, the Worker falls through to the **idle profile** and returns `200` with a frame. Treating an unscheduled overnight as an error would mean the radiator's nightly behaviour is driven by an error path, which inverts the relationship.
- **Metlink staleness preferred over 502.** If Metlink is unreachable but the **KV cache** has any entry — even past its 30 s TTL — the Worker serves the stale frame as `200` with `X-Cache-Status: stale-served`. The panel keeps showing recent transit data instead of a black-screen "outage" event. PRD §7 says the panel retains its last valid frame for ambient reasons; serving a slightly-old frame is the same idea, one layer up. A `502` only fires when there is no cache at all to fall back to.
- **Plain-text bodies, never JSON.** ~~Error responses carry one short lowercase string. The body is for a human reading `curl` output; the radiator's firmware ignores it. No schema, no encoding, no parser.~~ **Superseded by [ADR-0011](0011-error-contract-problem-details.md):** every error is now an `application/problem+json` document (RFC 9457). The #56 grill found the radiator-ignored body let config errors (a bad `METLINK_API_KEY`) decay into silent dashes; errors must be visible and machine-readable instead.

### Worker observability response headers

The Worker sets diagnostic headers (`X-Server-Time`, `X-Profile-Phase`, `X-Metlink-Fetched-At`, `X-Cache-Status`) on every response where the value is meaningful. These are **response-only and radiator-ignored** — they exist for a human running `curl` against `/v1/frame`, or a future polling tool, to diagnose "what did the Worker think when it produced this response" without needing Worker logs.

Because the radiator ignores them, **new ones are free.** Any future Worker-side response header in the `X-*` namespace can be added without a firmware change or a contract version bump. Document additions in the OpenAPI as the Worker evolves.

### Idle profile

When server time falls outside every configured profile phase for the slug, the Worker resolves an **idle profile**: a system-wide default that takes over the slot. The response is `200` with a frame and `X-Sleep-Seconds = min(seconds_until_next_configured_phase_start, 14400)` — the radiator wakes exactly when the next real phase opens, capped at 4 h.

The actual layout used by the idle profile, the content source (quote, joke, date roll, …), and the visual design are **out of scope for this ADR** and tracked in a follow-up issue (#17). Until that ships, a placeholder implementation may render the existing `minimal_clock` layout — the wire contract is unaffected.

### Radiator firmware behaviour

The firmware's loop is fixed by PRD §7 ("the panel retains its last valid frame indefinitely without power"). The Worker's wire contract is in OpenAPI; the radiator's response-handling spec is here, because it's a firmware design decision that does not appear on the wire:

> **The two `Any non-2xx` rows are superseded by [ADR-0011](0011-error-contract-problem-details.md).** Instead of "do not touch panel", the radiator now parses the `problem+json` body and renders a generic error screen (heading = `title`, body = `detail`; `upstream_detail` under the `verbose` flag), then sleeps for `X-Sleep-Seconds` (or the `300 s` fallback if absent). The `200 OK` rows and the "no response at all" row are unchanged.

| Response received | Firmware action |
|---|---|
| `200 OK` with valid gzipped BMP + `X-Sleep-Seconds` | Decompress, flush frame to panel, deep-sleep for `X-Sleep-Seconds` |
| `200 OK` but body decompression/parse fails | Do not touch panel (retains last valid frame). Deep-sleep for `X-Sleep-Seconds` if present, else firmware fallback (300 s) |
| Any non-2xx with `X-Sleep-Seconds` | Do not touch panel. Deep-sleep for `X-Sleep-Seconds` |
| Any non-2xx without `X-Sleep-Seconds` | Do not touch panel. Deep-sleep for firmware fallback (300 s) |
| **No response at all** (Wi-Fi fail, DNS fail, TCP timeout, TLS fail, HTTP timeout) | Do not touch panel. Deep-sleep for firmware fallback (300 s) |

The radiator MUST NOT log to flash, ~~MUST NOT alter the panel on any non-2xx,~~ and MUST NOT escalate retry frequency between wake cycles. The wake cadence is the retry cadence. (Per [ADR-0011](0011-error-contract-problem-details.md) the radiator now *does* alter the panel on a non-2xx — it renders the generic error screen; the no-flash-logging and no-retry-escalation rules still hold.)

---

## Why this preserves "Dumb Radiator, Smart Edge"

Per PRD §8 the radiator performs zero data processing. This contract keeps that invariant:

- The radiator parses exactly two response artefacts: the gzipped BMP body (mechanical decompress + flush) and the integer `X-Sleep-Seconds` header.
- All status codes collapse to a binary firmware decision: "got a frame to flush? yes/no." Everything else is sleep.
- Telemetry headers (battery, hardware id, RSSI, firmware version) are set by `printf`-grade code on the radiator. No JSON encoding, no schema, no client-side conditional logic.
- Sleep authority lives entirely on the Worker whenever the radiator reaches it. The firmware constant is a recovery floor, not a participant in normal operation.

---

## Glossary impact

The following terms must be added or updated in [`../glossary.md`](../glossary.md):

| Term | Section | Action |
|---|---|---|
| **Hardware id** | §8 (Radiator ↔ Worker contract) | **Add.** "Stable per-board identifier (typically the ESP32-S3 MAC address). Distinct from the **radiator slug** — survives slug reassignment. Sent via `X-Radiator-Hardware-Id` when present." |
| **Idle profile** | §7 (Profiles & modes) | **Add.** "A system-wide default profile that takes over when server time falls outside every configured **profile phase** of the slug's profile. Renders a low-frequency ambient layout with a long **sleep duration** (capped at 4 h)." |
| `X-Radiator-Hardware-Id` | §8 | **Add as 'Appears as'** of the hardware id entry. |
| `RADIATOR_SHARED_TOKEN` | §8 | Already present under **shared token**; no change. |
| Reserved namespace `X-Radiator-*` | §8 | **Add** a note: future radiator-side telemetry headers use this prefix; the Worker ignores unknown `X-Radiator-*` headers. |
| Worker informational response headers | §8 | **Add** a note that the Worker sets `X-Server-Time`, `X-Profile-Phase`, `X-Metlink-Fetched-At`, `X-Cache-Status` on responses for diagnostics. Radiator ignores them. New ones can be added freely. |

---

## Consequences

### Positive

- **Single source of truth for sleep cadence.** The Worker can adjust radiator wake frequency during incidents (slow them down on 5xx, speed them up after a deploy) without firmware changes.
- **Header-only telemetry is extensible without a contract bump.** Adding `X-Radiator-Battery-Pct` later is a unilateral firmware change; no Worker change, no ADR.
- **No oracle on auth failures.** Missing-vs-invalid token cannot be distinguished from the outside.
- **Overnight battery savings via the idle profile.** A 06:30 phase start at 22:00 means one wake until morning instead of 144 minute-clock ticks.
- **Clear firmware behaviour.** Every response path collapses to "flush or not, sleep for how long" — five rows, no judgement calls.
- **Machine-readable contract.** OpenAPI gives us Swagger UI, Redoc, codegen for both Worker and integration tests with no hand-maintained mirror.

### Negative / follow-ups

- **Glossary changes required.** Three new entries (`hardware id`, `idle profile`, reserved namespace note). Update in the same commit as the ADR to keep the language single-context.
- **Idle profile content design deferred.** Tracked as issue #17. Until shipped, the idle profile may render `minimal_clock` as a placeholder — the wire contract is unaffected.
- **URL versioning means a `/v2/` migration is a real cutover.** Bumping the path version requires re-flashing every radiator in the field. Acceptable at 5 units; the cost is intentional — it forces serious consideration before bumping. Side-by-side `/v1/` + `/v2/` operation during migration is easy.
- **Metlink staleness behaviour surfaced via `X-Cache-Status: stale-served`.** Humans inspecting the response can spot it; the radiator ignores it. Users only see "the bus times haven't moved in 3 minutes." Acceptable per PRD §7 — the panel keeping the last valid frame is the intended ambient behaviour.
- **`X-Sleep-Seconds: 14400` upper bound.** Idle overnight gaps longer than 4 h will produce intermediate wakes. Battery-suboptimal at the margin but worth it as a safety net for config bugs. Revisit if empirical battery telemetry shows the cap is the limiting factor.
- **OpenAPI must stay in lock-step with this ADR.** When a decision here changes, the OpenAPI changes in the same PR. The CI lint (Redocly) is the immediate guard against drift; the long-term guard is treating the OpenAPI as the wire spec and this ADR as the rationale — never duplicating field-level detail across them.

---

## Verification

When the Worker PoC implements this contract, the following must hold. Treat these as acceptance tests for the ADR — the OpenAPI examples show the expected wire format; this list shows the behavioural commitments that fall out of the decisions above.

1. `curl -H "X-Radiator-Slug: bedroom-philip-tania" -H "X-Radiator-Token: <secret>" -H "Accept-Encoding: gzip" --compressed -o frame.bmp https://<worker>/v1/frame` → `200 OK`, valid 64,862-byte BMP after gunzip, `X-Sleep-Seconds` in `[30, 14400]`, `Content-Type: image/bmp`, `Content-Encoding: gzip`, `X-Server-Time` and `X-Profile-Phase` present.
2. Same request with no `X-Radiator-Token` → `401 Unauthorized`, body `unauthorized`, `X-Sleep-Seconds: 3600`.
3. Same request with a wrong `X-Radiator-Token` → identical 401 response (no oracle).
4. Same request with `X-Radiator-Slug: not-a-real-slug` → `404 Not Found`, body `unknown radiator`, `X-Sleep-Seconds: 3600`.
5. Worker forced into the no-active-phase code path → `200 OK` with the idle-profile frame, `X-Sleep-Seconds` reflects seconds-until-next-phase-start (capped at 14400), `X-Profile-Phase: idle_profile`.
6. Worker forced to fail Metlink with no cache present → `502 Bad Gateway`, body `upstream unavailable`, `X-Sleep-Seconds: 60`.
7. Worker forced to fail Metlink with a past-TTL cache entry present → `200 OK` with the cached frame, `X-Cache-Status: stale-served`, `X-Metlink-Fetched-At` reflecting the original fetch time.
8. Firmware integration test (issue #4): pull the network cable mid-request → radiator deep-sleeps for exactly 300 s, panel retains the last frame.
9. The OpenAPI spec at `../api/openapi.yaml` lints clean under `redocly lint` (or equivalent OpenAPI 3.1 validator).

---

## References

- [OpenAPI spec](../api/openapi.yaml) — authoritative wire contract
- [PRD v0.4](../PRD/GottaGo%20PRD%20v0.4.md) §6 (functional requirements), §7 (error handling, power management), §8 (architecture, request/response contract)
- [Glossary](../glossary.md) §7 (profiles & modes), §8 (radiator ↔ worker contract)
- [ADR-0001](0001-frame-transport-compression.md) — `Content-Encoding: gzip` on the frame body
- [ADR-0002](0002-metlink-stop-predictions-field-mapping.md) — Metlink upstream contract; cancellation behaviour open question
- Related issues: #3 (this ADR), #4 (firmware tracer), #5 (`priority_split` slice), #17 (idle-profile layout & content design)
