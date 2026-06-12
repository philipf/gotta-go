# ADR-0016: Gateways for external systems

- **Status:** Accepted
- **Date:** 2026-06-13
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related:** Builds on [ADR-0005](0005-worker-source-architecture.md) (gateway
  tier, wire-format quarantine, DI) and
  [ADR-0007](0007-worker-architectural-pillars.md) (Deep Modules, REPR);
  supersedes ADR-0007's `gateways/metlink/metlink.ts` module-named example for
  the gateway tier. [ADR-0014](0014-layout-service-depth-and-context-slices.md)
  is the parallel contract/derivation split in the feature tier.

## Context

The worker talks to external systems: the Metlink API for arrival predictions,
a Cloudflare KV namespace for public holidays, and more will follow. Each
upstream brings its own wire format, failure modes, and request etiquette. Left
unstructured, those details leak into features, and every new integration is
designed from scratch.

This ADR records the standard structure of a gateway. `gateways/metlink/` is
the reference implementation.

## Decision

Use Martin Fowler's **Gateway pattern**, formalised by **Deep Modules** and
**REPR**, with files and declarations organised as an **inverted pyramid**. The
sections below follow that same rule (§7): highest overview first.

### 1. The Gateway pattern sets the structure

Every external system is reached through a **gateway** (Fowler): an in-process
module whose API is shaped by *this application's* needs, not the upstream's.
The gateway owns the upstream URL or binding, request etiquette, wire format,
and failure taxonomy; callers see only domain types.

### 2. Deep Modules are the why

A gateway is the canonical Deep Module (ADR-0007 §1): one capability function
as the public surface, substantial implementation hidden behind it — transport,
status classification, wire→domain mapping. The depth is what makes the
quarantine real: nothing upstream-shaped fits through a surface this small.

### 3. REPR names the contract

Contract types follow REPR (ADR-0007 §3): `<Verb><Noun>Request` and
`<Verb><Noun>Response`. Error types are **gateway-qualified**
(`MetlinkGatewayError`, not `GatewayError`) so they read as something and
cannot collide when two gateways' errors meet at a call site.

### 4. A gateway is a contract over a hidden composition

A gateway folder presents **one contract file** — its bulkhead (ADR-0005
§Gateways) — behind which the implementation is split across composed files:
one altitude per file.

Canonical layout (`gateways/metlink/`):

```
fetch-arrivals.ts        contract  — the public face: types + capability + re-export
fetch-arrivals-impl.ts   impl      — the orchestrator (call → classify → map)
client.ts                transport — upstream URL, headers, etiquette
mapper.ts                wire→domain quarantine (ADR-0005 §rule 2)
wire-types.ts            the raw wire shape
```

Tests and `fixtures.ts` sit alongside the files they cover.

The pattern is transport-agnostic: `gateways/public_holidays/` is the same
shape over a Cloudflare KV read — its `client.ts` issues the KV `get`, and it
omits `wire-types.ts` because the stored value has no wire shape worth naming.

### 5. Contract and implementation are separate files, named by role

- **`<capability>.ts` is the contract**: the request type, the response type,
  their payload/error types, and the capability expressed as a **function
  type**. It is implementation-free — no HTTP, no JSON, no status handling. A
  reader gets the whole interface in one screen.
- **`<capability>-impl.ts` is the implementation**: the orchestrator, declared
  `const fetchArrivalsImplementation: FetchArrivals` so the compiler binds body
  to contract — the two cannot drift.
- **The contract re-exports the implementation** under the clean public name
  (`export { fetchArrivalsImplementation as fetchArrivals }`), giving callers a
  **single import site**: function and types from the one capability-named
  file. This is chosen over a type-only contract. The resulting
  `contract → impl` runtime edge is type-erased on the way back (the impl
  imports only the contract *type*), so it carries no cycle and no cold-start
  cost; and the re-export forwards **only the public capability** — `client` /
  `mapper` / parsing stay hidden — so it is a contract pointer, not the
  forwarding module ADR-0007 §1 warns against.
- **No OO interface.** The function type *is* the contract — the
  idiomatic-functional equivalent of an interface. We do not introduce
  `IFooGateway` classes or interfaces.

### 6. Composed files earn their place by role or substance, not line count

The implementation is composed of small files, each justified by an
**architectural role** even when it is tiny:

- **`client.ts`** — the transport bulkhead: the one place that knows the
  upstream URL, headers, and request etiquette. Kept separate even for a
  one-call gateway so "how we talk to the upstream" never leaks into the
  orchestrator.
- **`mapper.ts`** — the wire→domain quarantine (ADR-0005 §rule 2): the only
  file that reads upstream field names. The role, not the size, earns the file.
- **`wire-types.ts`** — the raw wire shape, named to distinguish it from the
  contract/domain types in `<capability>.ts`; present only when there is a wire
  shape worth naming (§4).

### 7. Inverted-pyramid ordering

Declare from **highest overview to lowest detail**, in contract files and in
governing docs (this ADR included):

> capability → request → response → response payloads/errors → wiring.

In `fetch-arrivals.ts`: `FetchArrivals`, then `FetchArrivalsRequest`,
`FetchArrivalsResponse`, `StopState` / `Arrival`, `MetlinkGatewayError`, then
the re-export as the footer. TypeScript hoists type aliases, so forward
references are free — the ordering serves the reader, not the compiler.

## Consequences

### Positive

- "Open the contract, see the whole interface" is literally true: request,
  response, error surface — no plumbing.
- Cross-gateway name collisions are impossible; call sites read clearly.
- The earn-your-file test gives a concrete reason for each file and keeps all
  gateways structurally uniform.
- The implementation is compiler-bound to its contract — the two cannot
  silently drift.

### Negative / trade-offs

- A gateway is five files for what can be ~60 lines of logic. The split is
  deliberate (one altitude per file); the cost is more files to open.
- The `contract → impl` re-export reads as an inverted dependency — a contract
  importing its own implementation. It is type-erased-safe but aesthetically
  backward; the type-only alternative was rejected for its call-site ergonomic
  cost (two imports, and the function's path no longer the capability-named
  file).

## References

- Martin Fowler, *Gateway* — <https://martinfowler.com/articles/gateway-pattern.html>
- [ADR-0005](0005-worker-source-architecture.md) — gateway tier, wire-format
  quarantine (§rule 2), DI, testing posture
- [ADR-0007](0007-worker-architectural-pillars.md) — Deep Modules (Ousterhout)
  and REPR (Smith), with their primary sources
- [ADR-0014](0014-layout-service-depth-and-context-slices.md) — the parallel
  contract/derivation split in the feature tier
- `gateways/metlink/` — the reference implementation
- `gateways/public_holidays/` — the same shape over Cloudflare KV
