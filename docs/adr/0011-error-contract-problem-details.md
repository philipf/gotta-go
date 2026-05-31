# ADR-0011: Error contract — RFC 9457 `problem+json` failure model

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Philip Fourie
- **Wire specification:** [`../api/openapi.yaml`](../api/openapi.yaml) — the authoritative *what* (the `problem+json` schema, the status codes, the per-type bodies). This ADR is the *why*.
- **Human-readable target:** [`../api/errors.md`](../api/errors.md) — the document each problem `type` URL dereferences to, one anchor per slug.
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.
- **Related:** [#56](https://github.com/philipf/gotta-go/issues/56) (parent — Metlink failure policy), [#58](https://github.com/philipf/gotta-go/issues/58) (this slice — contract + ADR), [#59](https://github.com/philipf/gotta-go/issues/59) (Worker emits `problem+json`), [#60](https://github.com/philipf/gotta-go/issues/60) (firmware error screen), [ADR-0003](0003-radiator-worker-contract.md) (the contract this supersedes parts of), [ADR-0004](0004-diagnostics-view-content-negotiation.md) (content negotiation), [ADR-0005](0005-worker-source-architecture.md) (the gateway typed-`Result` bulkhead), [#55](https://github.com/philipf/gotta-go/issues/55) (structured logging), [#47](https://github.com/philipf/gotta-go/issues/47) (firmware stale indicator).

## Context

[ADR-0003](0003-radiator-worker-contract.md) settled the radiator ↔ Worker contract on two error rules, both premised on "Dumb Radiator, Smart Edge":

1. **Plain-text, radiator-ignored bodies.** Every error returned one short lowercase string (`unauthorized`, `upstream unavailable`, …). The radiator's firmware ignored it; the status code drove behaviour.
2. **Hold the last frame on any non-2xx.** The panel kept showing its last valid frame on every error, and the radiator just slept for `X-Sleep-Seconds`.

[#56](https://github.com/philipf/gotta-go/issues/56) showed where that leads. `features/priority_split/service.ts` collapsed *every* classified Metlink failure to a "closed" stop rendered as dashes — `network`, `rate_limited`, `upstream`, **and `auth`** alike. A broken or expired `METLINK_API_KEY` — a configuration error a human must fix — was silently papered over as dashes forever. The gateway's rich `GatewayError` union (`auth | rate_limited | upstream | network`, per [ADR-0005](0005-worker-source-architecture.md)) was computed and then thrown away. Errors went into the ether.

The #56 grill settled the principle: **errors must be visible, not silently degraded.** The Worker emits a machine-readable error; the firmware renders a generic error screen rather than holding the last frame and hoping a human notices the bus times stopped moving. This ADR defines that contract. It is the contract + decision record only — the code that builds to it lands in two sibling slices, both **blocked by this one**:

- **[#59](https://github.com/philipf/gotta-go/issues/59)** — *Worker: emit `problem+json` error responses, stop silent degrade.* Adds a gateway `client_error` kind, a `shared/errors.ts` error hierarchy, service-layer throws, a boundary that turns a raised error into a `problem+json` response, converts every existing error response, removes the dead cache headers code-side, and enforces the 2 KB snippet cap.
- **[#60](https://github.com/philipf/gotta-go/issues/60)** — *Firmware: render the `problem+json` error screen.* Parses the problem document, renders a generic `title` + `detail` screen, and adds a `verbose` flag in `setting.h` gating `upstream_detail`. Relates to [#47](https://github.com/philipf/gotta-go/issues/47).

This ADR also retires the cache-era error model. [ADR-0010](0010-no-metlink-cache-layer.md) removed the caching layer, leaving ADR-0003's "Metlink staleness preferred over 502" rule (serve a past-TTL `stale-served` frame instead of erroring) describing a path with nothing to fall back on. That rule, and the now-vestigial `X-Cache-Status` / `X-Metlink-Fetched-At` observability headers, are superseded here: a Metlink failure returns a `502` problem document, full stop.

## Decision

### Every error is an RFC 9457 problem document

Every non-2xx response carries `Content-Type: application/problem+json` and a body conforming to [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457). The members:

| Member | Source | Meaning |
|---|---|---|
| `type` | per problem type | An HTTPS URL into [`errors.md`](../api/errors.md#) — `https://github.com/philipf/gotta-go/blob/main/docs/api/errors.md#<slug>`. The stable machine-readable identity of the problem type; dereferences to human-readable docs. |
| `title` | per problem type | Short, human-readable summary of the *type* — stable across occurrences. Doubles as the **panel heading** for the firmware error screen. |
| `status` | per problem type | The HTTP status code, duplicated in the body per RFC 9457 §3.1 so the document is self-describing when logged or forwarded. |
| `detail` | per occurrence | Clean human-readable prose specific to *this* occurrence (e.g. which stop, which upstream status). |
| `instance` | per occurrence | `urn:gotta-go:request:<requestId>`, where `<requestId>` is the inbound `X-Request-Id`. **Omitted** when no `X-Request-Id` was supplied. |
| `upstream_detail` | per occurrence | **Extension member** (RFC 9457 §3.2). The raw upstream snippet (e.g. Metlink's error body), capped at **2 KB**. Present only for problem types that have an upstream cause. The firmware renders it **only under its `verbose` flag**; ordinary clients ignore unknown extension members. |

**`X-Sleep-Seconds` stays a response header, never a body member.** Sleep authority is a transport concern owned by every response (ADR-0003); duplicating it into the problem document would create two sources of truth. The firmware reads the header exactly as before.

The **2 KB snippet cap** is shared by the wire (`upstream_detail`) and the structured logs ([#55](https://github.com/philipf/gotta-go/issues/55)) — one constant, one truncation rule, so a log line and a problem document never disagree about how much upstream context survived.

### Problem documents replace the negotiated success format

Per [ADR-0004](0004-diagnostics-view-content-negotiation.md) the success response is content-negotiated (BMP, SVG, or JSON view model). **Errors are always `application/problem+json` regardless of the negotiated success format.** A radiator that sent `Accept: image/bmp` still receives a problem document on failure. This keeps one error shape across every client; the status code still drives the firmware's binary "flush a frame, or show the error screen" decision, so the negotiated `Accept` is irrelevant on the error path.

### Two orthogonal axes: status × class

Every problem type is positioned on two independent axes:

- **`status` — whose fault is it?**
  - **`500`** — *ours*: a GottaGo configuration error or bug (a bad `METLINK_API_KEY`, a bad stop id in `config.yaml`, an unhandled throw).
  - **`502`** — *upstream's*: Metlink is failing or unreachable.
  - (`401` / `404` are the standard auth/identity/path cases and predate this axis.)
- **`class` — will it self-heal?**
  - **Fatal** → a human must act. Back off hard: **`X-Sleep-Seconds: 3600`** (1 h) + an **`error`**-level log. A tight retry loop against a misconfiguration is pure noise.
  - **Retryable** → transient; the next wake may well succeed. Sleep at the **normal phase cadence** (the same `X-Sleep-Seconds` a `200` for the active profile phase would have used) + a **`warn`**-level log.

The split matters because *whose fault* and *will it self-heal* are genuinely independent: a Metlink `429` is upstream's fault (`502`) but self-heals (Retryable), while a bad API key is also rejected by Metlink but is **ours** (`500`) and Fatal.

### Problem-type catalog

| `type` slug | status | class | `X-Sleep-Seconds` | log | trigger |
|---|---|---|---|---|---|
| `metlink-auth` | 500 | Fatal | 3600 | error | Metlink `401`/`403` — bad/expired `METLINK_API_KEY` |
| `metlink-bad-request` | 500 | Fatal | 3600 | error | Metlink `4xx` (except `429`) — bad stop/service id in config |
| `metlink-unavailable` | 502 | Retryable | phase cadence | warn | Metlink `5xx` / network failure / timeout |
| `metlink-rate-limited` | 502 | Retryable | phase cadence | warn | Metlink `429` |
| `internal` | 500 | Retryable | phase cadence (`300` if thrown before phase resolution) | error | any unknown thrown error |
| `unauthorized` | 401 | Fatal | 3600 | warn | bad/missing **shared token** |
| `unknown-radiator` | 404 | Fatal | 3600 | warn | **radiator slug** not in `config.yaml` |
| `not-found` | 404 | — | *none* (firmware `300` fallback) | — | unknown path (dev/curl only) |

Notes:

- **`internal` is Retryable, not Fatal.** Most unhandled throws are transient (a deploy mid-flight, a hiccup), so the default is a normal-cadence retry — but it logs at `error` because an unknown throw always warrants a human's eyes. If it is thrown *before* a profile phase has been resolved (so there is no cadence to inherit), the firmware's `300 s` fallback applies and no `X-Sleep-Seconds` is sent.
- **`not-found` carries no `X-Sleep-Seconds`.** It is reachable only by a human hitting an unknown path; a radiator never does. The firmware's `300 s` fallback covers the theoretical case.
- **`unauthorized` and `unknown-radiator` log at `warn`, not `error`.** They are routine on a misconfigured re-flash and are not actionable server-side; they are Fatal only in the self-heal sense (an hour of back-off until a human fixes the token or slug).
- **`503` maintenance** (the operator-triggered mode already in the contract) is brought into the same `problem+json` envelope for consistency, with an operator-chosen `X-Sleep-Seconds` in the standard `[30, 14400]` range. It is *not* part of the #56 failure-policy catalog — it is an operator action, not a failure — and so sits outside the status×class taxonomy above.

### Firmware behaviour: render a generic error screen

This **supersedes ADR-0003's "hold the last frame on any non-2xx" rule.** On any non-2xx the radiator now:

1. Parses the `problem+json` body.
2. Renders **one generic error screen** — heading = `title`, body = `detail`; `upstream_detail` is appended only when the firmware's `verbose` flag is set. ("Generic" = a single error layout for every type. Per-error-type screens / icons are a later slice.)
3. Sleeps for `X-Sleep-Seconds`, or the `300 s` firmware fallback when the header is absent (e.g. `not-found`).

This is a **deliberate, scoped relaxation of "Dumb Radiator".** The success path is unchanged — mechanical gunzip of the BMP plus an integer header parse, no JSON. Only the error path gains a minimal `problem+json` read, and it buys the one thing silent degradation cost us: **visibility**. A wrong API key now puts a legible error on the panel instead of dashes that look like a quiet evening with no buses.

## ADR-0003 rules this supersedes

| ADR-0003 rule | Replacement |
|---|---|
| "Plain-text bodies, never JSON" (§Error model) — one short lowercase string, radiator-ignored | Every error is an `application/problem+json` document (above). |
| "Hold the last frame on any non-2xx" (§Radiator firmware behaviour, the non-2xx table rows) | The radiator renders a generic error screen from the problem document (above). |
| "Metlink staleness preferred over 502" / `stale-served` (§Error model) — serve a past-TTL cached frame instead of erroring | No caching layer exists ([ADR-0010](0010-no-metlink-cache-layer.md)), so a Metlink failure returns a `502` problem document (`metlink-unavailable` / `metlink-rate-limited`). The `X-Cache-Status` and `X-Metlink-Fetched-At` headers and their JSON-envelope mirrors are retired with it. |

ADR-0003's other decisions — `GET /v1/frame`, header-based auth/identity, the `401`-no-oracle and `404`-unknown-slug status choices, sleep authority and its `[30, 14400]` bounds, the firmware `300 s` fallback, the `X-Radiator-*` reserved namespace — all stand unchanged.

## Consequences

### Positive

- **Errors are visible and machine-readable.** A config error reaches a human (an `error` log + a legible panel screen) instead of decaying into dashes.
- **One error shape everywhere.** Every status code, every negotiated `Accept`, returns the same `problem+json` document. Clients and tests have one schema to learn.
- **`type` URLs are self-documenting.** Dereferencing a `type` lands a human on the exact `errors.md` anchor describing cause and operator action — no log-spelunking to decode a status code.
- **The status×class taxonomy makes the policy auditable.** Adding a future gateway means placing each of its failures on the two axes; the sleep/log behaviour falls out of the cell, not a fresh judgement call.
- **Extensible without a contract bump.** RFC 9457 mandates consumers ignore unknown extension members, so future fields (a second gateway's `upstream_detail` sibling, a retry hint) are additive.

### Negative / follow-ups

- **The firmware now parses JSON on the error path.** A real, if scoped, departure from "Dumb Radiator". Mitigated by confining it to non-2xx responses and to a single generic layout; the happy path stays parser-free. Firmware implementation lands in [#60](https://github.com/philipf/gotta-go/issues/60).
- **`type` URIs are pinned to GitHub `blob/main` URLs.** Chosen because it is the only stable, dereferenceable target that exists today. RFC 9457 treats the `type` URI as identity, so moving `errors.md` to a docs site later is a breaking change for any client matching on `type` — do it at a deliberate contract revision, ideally behind a redirect, not casually.
- **Loss of the `stale-served` resilience fallback.** With the cache gone ([ADR-0010](0010-no-metlink-cache-layer.md)) a Metlink outage can no longer be papered over with a slightly-old frame; the panel shows the error screen instead. Acceptable — the outage is now *visible*, which is the whole point — and Metlink outages are typically brief, so the next wake recovers.
- **Per-error-type firmware screens deferred.** The contract carries per-type `title`/`detail` so the firmware *can* differentiate later; today it renders one generic screen.

## Glossary impact

The following terms are added to [`../glossary.md`](../glossary.md) §8 (Radiator ↔ Worker contract):

| Term | Action |
|---|---|
| **Problem document** | **Add.** The RFC 9457 `application/problem+json` body returned on every error: `type`, `title`, `status`, `detail`, `instance`, plus the `upstream_detail` extension. |
| **Problem type** | **Add.** A named, catalogued failure (`metlink-auth`, `unauthorized`, …) identified by a stable `type` URL into `errors.md`. |
| **Fatal / Retryable** | **Add.** The self-heal axis: Fatal → `3600 s` + `error` log (a human must act); Retryable → phase-cadence sleep + `warn` log (the next wake may succeed). |
| **`upstream_detail`** | **Add as a sub-note** of the problem-document entry: the verbose-gated, 2 KB-capped raw upstream snippet. |

## Verification

When the Worker implements this contract, the following must hold (acceptance tests for the ADR; the OpenAPI examples show the exact wire format):

1. Request with no `X-Radiator-Token` → `401`, `Content-Type: application/problem+json`, body `type` ending `#unauthorized`, `status: 401`, `X-Sleep-Seconds: 3600`.
2. Request with `X-Radiator-Slug: not-a-real-slug` → `404`, `type` ending `#unknown-radiator`, `X-Sleep-Seconds: 3600`.
3. Worker forced to see a Metlink `401`/`403` → `500`, `type` ending `#metlink-auth`, `X-Sleep-Seconds: 3600`, an `error` log, and an `upstream_detail` ≤ 2 KB.
4. Worker forced to see a Metlink `429` → `502`, `type` ending `#metlink-rate-limited`, `X-Sleep-Seconds` equal to the active phase cadence, a `warn` log.
5. Worker forced to see a Metlink `5xx`/timeout → `502`, `type` ending `#metlink-unavailable`, phase-cadence sleep, `warn` log.
6. Any of the above sent with `Accept: image/bmp` still returns `application/problem+json` (errors ignore the negotiated success format).
7. A request carrying `X-Request-Id: abc` produces `instance: urn:gotta-go:request:abc`; the same request without the header omits `instance` entirely.
8. Every `type` URL resolves to a live anchor in [`errors.md`](../api/errors.md).
9. The OpenAPI spec lints clean under `redocly lint` (or an equivalent OpenAPI 3.1 validator).

## References

- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457) (obsoletes RFC 7807).
- ["Problem Details (RFC 9457): Doing API Errors Well"](https://swagger.io/blog/problem-details-rfc9457-doing-api-errors-well/) — Swagger write-up.
- [OpenAPI spec](../api/openapi.yaml) — authoritative wire contract.
- [`errors.md`](../api/errors.md) — the `type`-URL dereference target.
- [Glossary](../glossary.md) §8 (radiator ↔ worker contract).
- [ADR-0003](0003-radiator-worker-contract.md) — the contract this supersedes parts of.
- [ADR-0004](0004-diagnostics-view-content-negotiation.md) — content negotiation on the success path.
- [ADR-0005](0005-worker-source-architecture.md) — the gateway typed-`Result` bulkhead that classifies `GatewayError`.
- Related issues: [#56](https://github.com/philipf/gotta-go/issues/56) (parent), [#58](https://github.com/philipf/gotta-go/issues/58) (this slice — contract + ADR), [#59](https://github.com/philipf/gotta-go/issues/59) (Worker emits `problem+json`), [#60](https://github.com/philipf/gotta-go/issues/60) (firmware error screen), [#55](https://github.com/philipf/gotta-go/issues/55) (structured logging), [#47](https://github.com/philipf/gotta-go/issues/47) (firmware stale indicator).
