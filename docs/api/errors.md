# GottaGo error catalog

This is the human-readable target every **problem document** `type` URL
dereferences to. When the Worker returns an error it emits an
`application/problem+json` body (RFC 9457) whose `type` is
`https://github.com/philipf/gotta-go/blob/main/docs/api/errors.md#<slug>` — the
`<slug>` is the anchor of the matching section below.

- **The contract** (wire shapes, status codes, examples): [`openapi.yaml`](openapi.yaml).
- **The decisions** (why `problem+json`, the status×class taxonomy, the firmware error screen): [ADR-0011](../adr/0011-error-contract-problem-details.md).
- **The vocabulary** (problem document, problem type, Fatal/Retryable, `upstream_detail`): [glossary §8](../glossary.md).

## How to read an entry

Every problem document carries `type`, `title`, `status`, `detail`, an optional
`instance` (`urn:gotta-go:request:<requestId>`), and — for upstream failures —
a verbose-gated `upstream_detail` snippet (≤ 2 KB). `X-Sleep-Seconds` rides as a
response **header**, never in the body.

Two orthogonal axes classify each type:

- **`status` — whose fault?** `500` is *ours* (a GottaGo config error or bug);
  `502` is *upstream's* (Metlink). `401`/`404` are the standard auth/identity/path cases.
- **`class` — will it self-heal?** **Fatal** → a human must act (sleep `3600 s`,
  log at `error`); **Retryable** → transient, the next wake may succeed (sleep at
  the active **profile phase** cadence, log at `warn`).

| `type` | status | class | sleep | log |
|---|---|---|---|---|
| [`metlink-auth`](#metlink-auth) | 500 | Fatal | 3600 | error |
| [`metlink-bad-request`](#metlink-bad-request) | 500 | Fatal | 3600 | error |
| [`metlink-unavailable`](#metlink-unavailable) | 502 | Retryable | phase cadence | warn |
| [`metlink-rate-limited`](#metlink-rate-limited) | 502 | Retryable | phase cadence | warn |
| [`internal`](#internal) | 500 | Retryable | phase cadence (300 pre-resolution) | error |
| [`unauthorized`](#unauthorized) | 401 | Fatal | 3600 | warn |
| [`unknown-radiator`](#unknown-radiator) | 404 | Fatal | 3600 | warn |
| [`not-found`](#not-found) | 404 | — | none (firmware 300 fallback) | — |
| [`maintenance`](#maintenance) | 503 | — | operator-chosen | — |

---

## `metlink-auth`

- **Status:** `500` (ours) · **Class:** Fatal · **Sleep:** `3600` · **Log:** `error`
- **Title:** Transit data unavailable

Metlink rejected our request with `401` or `403`. The `METLINK_API_KEY` secret
is missing, wrong, or expired.

**What to do:** rotate or re-provision `METLINK_API_KEY` on the Worker. Until
then every `priority_split` render for affected stops fails the same way — the
hard `3600 s` back-off keeps the radiator from hammering a request that cannot
succeed without human action. The raw Metlink response is in `upstream_detail`
(under the firmware `verbose` flag, and in the structured logs).

## `metlink-bad-request`

- **Status:** `500` (ours) · **Class:** Fatal · **Sleep:** `3600` · **Log:** `error`
- **Title:** Transit target misconfigured

Metlink returned a `4xx` other than `429` — typically a bad stop id or service
id in a **transit target**. The request is malformed against Metlink, so
retrying it unchanged will never succeed.

**What to do:** check the offending `transit_targets:` entry in `config.yaml`
against Metlink's stop/service catalogue. `detail` names the rejected id;
`upstream_detail` carries Metlink's message.

## `metlink-unavailable`

- **Status:** `502` (upstream's) · **Class:** Retryable · **Sleep:** phase cadence · **Log:** `warn`
- **Title:** Transit data unavailable

Metlink is failing or unreachable — a `5xx`, a network error, or a timeout.
This is upstream's problem and usually brief.

**What to do:** nothing, usually. The radiator retries on its next regular wake
cycle (no special back-off — the phase cadence already paces it). If it
persists, check [Metlink's status](https://www.metlink.org.nz/) and the Worker
logs. `upstream_detail` carries whatever Metlink (or the edge) returned.

## `metlink-rate-limited`

- **Status:** `502` (upstream's) · **Class:** Retryable · **Sleep:** phase cadence · **Log:** `warn`
- **Title:** Transit data unavailable

Metlink returned `429` — we exceeded its rate limit. At household scale this
should be rare (Metlink allows 10 req/s sustained); a burst of synchronised
wakes is the likely cause.

**What to do:** nothing for a one-off — the next wake cycle retries. If it
recurs, the wake cadence across radiators watching the same stops may need
spreading out. `upstream_detail` carries Metlink's retry hint.

## `internal`

- **Status:** `500` (ours) · **Class:** Retryable · **Sleep:** phase cadence (`300` if pre-resolution) · **Log:** `error`
- **Title:** Unexpected error

Any unhandled thrown error inside the Worker. Retryable by default — most are
transient (a deploy mid-flight, a hiccup) — but always logged at `error`
because an unexpected throw warrants a human's eyes.

**What to do:** read the Worker logs for the stack. If the throw happened before
a **profile phase** was resolved there is no cadence to inherit, so no
`X-Sleep-Seconds` is sent and the firmware's `300 s` fallback applies.

## `unauthorized`

- **Status:** `401` · **Class:** Fatal · **Sleep:** `3600` · **Log:** `warn`
- **Title:** Radiator not authorised

The `X-Radiator-Token` header was missing or did not match the configured
`RADIATOR_SHARED_TOKEN`. The missing-token and wrong-token cases are
**indistinguishable by design** (no oracle) — see ADR-0003.

**What to do:** re-flash the radiator with the correct **shared token**, or
rotate `RADIATOR_SHARED_TOKEN` on the Worker. The `3600 s` back-off recovers
within a working day after a fix without hot-looping.

## `unknown-radiator`

- **Status:** `404` · **Class:** Fatal · **Sleep:** `3600` · **Log:** `warn`
- **Title:** Radiator not recognised

The `X-Radiator-Slug` did not match any key under `radiators:` in
`config.yaml`. The slug is identification, not authentication, so an unknown
slug is a `404`, not a `401` (see the `X-Radiator-Slug` parameter in
[`openapi.yaml`](openapi.yaml)).

**What to do:** add the slug under `radiators:` in `config.yaml`, or re-flash
the radiator with a configured slug.

## `not-found`

- **Status:** `404` · **Class:** — · **Sleep:** none · **Log:** —
- **Title:** Not found

The request path matched no route. A radiator only ever calls `GET /v1/frame`,
so this is reachable only by a human poking with `curl` at the wrong path.

**What to do:** check the path. No `X-Sleep-Seconds` is sent; the firmware's
`300 s` fallback covers the theoretical case where a radiator somehow lands
here.

## `maintenance`

- **Status:** `503` · **Class:** — · **Sleep:** operator-chosen `[30, 14400]` · **Log:** —
- **Title:** Under maintenance

Operator-triggered maintenance mode. This is **not** part of the failure-policy
catalog — it is an operator action, not a failure — but it is carried in the
same `problem+json` envelope for consistency.

**What to do:** wait. The operator sets the sleep duration; the radiator wakes
and retries after it.
