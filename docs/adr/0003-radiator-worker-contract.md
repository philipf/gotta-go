# ADR-0003: Radiator ↔ Worker HTTP contract

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Philip Fourie
- **Wire specification:** [`../api/openapi.yaml`](../api/openapi.yaml) — the authoritative *what* (paths, headers, status codes, response shapes, value ranges). This ADR is the *why*.
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.
- **Amended by:** [ADR-0011](0011-error-contract-problem-details.md) (error model → RFC 9457 `problem+json` + firmware error screen), [ADR-0010](0010-no-metlink-cache-layer.md) (no caching layer, so a Metlink failure returns `502`), [ADR-0013](0013-conditional-frame-requests.md) (the `304` conditional-frame path). This ADR reflects that current state directly; those ADRs hold the detail.

## Context

PRD v0.4 §8 and glossary §8 sketch the wire surface between the **radiator** and the **Worker** but leave several decisions unmade:

- HTTP method and URL path.
- `Content-Type` of the BMP response body.
- Status codes for missing token, invalid token, and unknown **radiator slug**.
- Whether error responses carry `X-Sleep-Seconds`, and what the radiator does when the Worker is completely unreachable.
- What the Worker returns when server time falls outside every configured **profile phase**.
- Future extensibility for radiator-side telemetry (battery level, hardware identifier, signal strength, firmware version).

Two existing constraints already pin pieces of the contract:

- **ADR-0001** locks `Content-Encoding: gzip` on the BMP body, with `Accept-Encoding: gzip` on the request. It is silent on `Content-Type` and on the URL.
- The **Metlink upstream behaviour** ([reference](../reference/metlink-stop-predictions.md)) is fixed but does not touch the Worker's outward-facing HTTP surface.

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

The status-code split is in the OpenAPI; the decisions behind it:

- **Every error is an `application/problem+json` document (RFC 9457).** A short machine- and human-readable body — `type` / `title` / `detail`, plus an optional `upstream_detail` — carries each error, per [ADR-0011](0011-error-contract-problem-details.md). The #56 grill found that a radiator-ignored plain-text body let config errors (e.g. a bad `METLINK_API_KEY`) decay into silent dashes on the panel; errors must be visible and machine-readable instead. The firmware renders a generic error screen from the document (see *Radiator firmware behaviour*).
- **No "no active profile phase" error.** When server time falls outside every configured phase, the Worker falls through to the **idle profile** and returns `200` with a frame. Treating an unscheduled overnight as an error would mean the radiator's nightly behaviour is driven by an error path, which inverts the relationship.
- **A Metlink failure returns `502`, not a stale frame.** There is no caching layer ([ADR-0010](0010-no-metlink-cache-layer.md)), so there is nothing stale to serve. A Metlink failure surfaces as a `502` `problem+json` document — `metlink-unavailable` for `5xx`/network/timeout, `metlink-rate-limited` for `429` — and the firmware shows the error screen.

### Worker observability response headers

The Worker sets diagnostic headers (`X-Server-Time`, `X-Profile-Phase`) on every response where the value is meaningful. These are **response-only and radiator-ignored** — they exist for a human running `curl` against `/v1/frame`, or a future polling tool, to diagnose "what did the Worker think when it produced this response" without needing Worker logs.

Because the radiator ignores them, **new ones are free.** Any future Worker-side response header in the `X-*` namespace can be added without a firmware change or a contract version bump. Document additions in the OpenAPI as the Worker evolves.

### Idle profile

When server time falls outside every configured profile phase for the slug, the Worker resolves an **idle profile**: a system-wide default that takes over the slot. The response is `200` with a frame and `X-Sleep-Seconds = min(seconds_until_next_configured_phase_start, 14400)` — the radiator wakes exactly when the next real phase opens, capped at 4 h.

The actual layout used by the idle profile, the content source (quote, joke, date roll, …), and the visual design are **out of scope for this ADR** and tracked in a follow-up issue (#17). Until that ships, a placeholder implementation may render the existing `minimal_clock` layout — the wire contract is unaffected.

### Radiator firmware behaviour

The firmware's loop is fixed by PRD §7 ("the panel retains its last valid frame indefinitely without power"). The Worker's wire contract is in OpenAPI; the radiator's response-handling spec is here, because it's a firmware design decision that does not appear on the wire.

| Response received | Firmware action |
|---|---|
| `200 OK` with valid gzipped BMP + `X-Sleep-Seconds` | Decompress, flush frame to panel, store the new `ETag`, deep-sleep for `X-Sleep-Seconds` |
| `304 Not Modified` ([ADR-0013](0013-conditional-frame-requests.md)) | Do not touch panel (retains last valid frame), keep the stored `ETag`, deep-sleep for `X-Sleep-Seconds` |
| `200 OK` but body decompression/parse fails | Do not touch panel. Deep-sleep for `X-Sleep-Seconds` if present, else firmware fallback (300 s) |
| Any non-2xx (`problem+json`) ([ADR-0011](0011-error-contract-problem-details.md)) | Parse the problem document, render the generic error screen (heading = `title`, body = `detail`; `upstream_detail` under the `verbose` flag), clear the stored `ETag`, deep-sleep for `X-Sleep-Seconds` (or 300 s fallback if absent) |
| **No response at all** (Wi-Fi fail, DNS fail, TCP timeout, TLS fail, HTTP timeout) | Do not touch panel. Deep-sleep for firmware fallback (300 s) |

**Conditional-frame (`ETag`) rules** ([ADR-0013](0013-conditional-frame-requests.md)): the radiator sends `If-None-Match` when an `ETag` is stored, stores a new `ETag` only after a successfully flushed `200`, and clears it when the error screen is rendered. The `ETag` is opaque — echoed, never inspected.

The radiator MUST NOT log to flash and MUST NOT escalate retry frequency between wake cycles. The wake cycle is the retry.

---

## "Dumb Radiator, Smart Edge" preserved

Per PRD §8 the radiator performs zero *semantic* work — no layout, schedule, or transit-data interpretation. It mechanically inflates the gzipped BMP, reads the integer `X-Sleep-Seconds`, echoes the opaque `ETag`, and on an error renders the problem document's `title`/`detail` into a fixed error screen. The Worker still owns 100% of the meaning.

---

## Consequences

### Positive

- **Single source of truth for sleep duration.** The Worker can adjust radiator wake frequency during incidents (slow them down on 5xx, speed them up after a deploy) without firmware changes.
- **Header-only telemetry is extensible without a contract bump.** Adding `X-Radiator-Battery-Pct` later is a unilateral firmware change; no Worker change, no ADR.
- **No oracle on auth failures.** Missing-vs-invalid token cannot be distinguished from the outside.
- **Errors are visible.** A config or upstream failure renders a legible error screen instead of decaying into silent dashes ([ADR-0011](0011-error-contract-problem-details.md)).
- **Overnight battery savings via the idle profile.** A 06:30 phase start at 22:00 means one wake until morning instead of 144 minute-clock ticks.
- **Machine-readable contract.** OpenAPI gives us Swagger UI, Redoc, codegen for both Worker and integration tests with no hand-maintained mirror.

### Negative / follow-ups

- **Idle profile content design deferred.** Tracked as issue #17. Until shipped, the idle profile may render `minimal_clock` as a placeholder — the wire contract is unaffected.
- **URL versioning means a `/v2/` migration is a real cutover.** Bumping the path version requires re-flashing every radiator in the field. Acceptable at 5 units; the cost is intentional — it forces serious consideration before bumping. Side-by-side `/v1/` + `/v2/` operation during migration is easy.
- **`X-Sleep-Seconds: 14400` upper bound.** Idle overnight gaps longer than 4 h will produce intermediate wakes. Battery-suboptimal at the margin but worth it as a safety net for config bugs. Revisit if empirical battery telemetry shows the cap is the limiting factor.
- **OpenAPI must stay in lock-step with this ADR.** When a decision here changes, the OpenAPI changes in the same PR. The CI lint (Redocly) is the immediate guard against drift; the long-term guard is treating the OpenAPI as the wire spec and this ADR as the rationale — never duplicating field-level detail across them.

---

## References

- [OpenAPI spec](../api/openapi.yaml) — authoritative wire contract
- [PRD v0.4](../PRD/GottaGo%20PRD%20v0.4.md) §6 (functional requirements), §7 (error handling, power management), §8 (architecture, request/response contract)
- [Glossary](../glossary.md) §7 (profiles & modes), §8 (radiator ↔ worker contract)
- [ADR-0001](0001-frame-transport-compression.md) — `Content-Encoding: gzip` on the frame body
- [ADR-0010](0010-no-metlink-cache-layer.md) — no caching layer; Metlink failure → `502`
- [ADR-0011](0011-error-contract-problem-details.md) — `problem+json` error contract + firmware error screen
- [ADR-0013](0013-conditional-frame-requests.md) — conditional frame requests (`ETag` / `304`)
- [Metlink reference](../reference/metlink-stop-predictions.md) — Metlink upstream contract; cancellation behaviour open question
- Related issues: #3 (this ADR), #4 (firmware tracer), #5 (`priority_split` slice), #17 (idle-profile layout & content design)
