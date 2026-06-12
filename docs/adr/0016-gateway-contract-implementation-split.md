# ADR-0016: Gateway internal structure — contract/implementation split, REPR naming, inverted-pyramid ordering

- **Status:** Accepted
- **Date:** 2026-06-13
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related contracts:** [ADR-0005](0005-worker-source-architecture.md) (gateway tier, wire-format quarantine, DI), [ADR-0007](0007-worker-architectural-pillars.md) (Deep Modules; module-named public file — amended here for the gateway tier), [ADR-0014](0014-layout-service-depth-and-context-slices.md) (the parallel contract/derivation split in the feature tier), #17 (idle_jokes content)

## Context

ADR-0007 named the gateway as the canonical Deep Module and pointed at
`gateways/metlink/metlink.ts` as the example: one `fetchArrivals(req)` function
hiding HTTP, wire types, and the wire→domain transformation. A first-pass review
of the AI-generated `icanhazdadjoke` gateway (this branch's pilot) found the
shape did not actually deliver on that promise — and that metlink shared the
same faults:

- **The public file mixed contract and implementation.** Types, a private
  body-snippet helper, and the orchestrator lived together; "open the file and
  read the contract" meant reading past the plumbing.
- **Generic type names.** `GatewayError` / `FetchResult` were exported from
  every gateway and collided at call sites — `idle_jokes/service.ts` imported
  `GatewayError` with nothing to say which gateway's.
- **Duplicated helpers.** Each gateway reimplemented a local `bodySnippet` that
  duplicated the existing `shared/errors.ts` `snippet()`.

These are presentation and naming faults, not behavioural ones — the gateway
already worked. This ADR records the structure a gateway should take so the next
one, and the metlink rewrite, is built to it rather than re-argued from first
principles.

Piloted on `icanhazdadjoke`; the `metlink` rollout is the planned next step (see
Consequences).

## Decision

The sections are ordered by the **inverted-pyramid** rule they also establish
(§5): highest overview first.

### 1. A gateway is a contract over a hidden composition

A gateway folder presents **one contract file** — its bulkhead (ADR-0005
§Gateways) — behind which the implementation is split across composed files.
This is ADR-0007 §1 (Deep Modules) made concrete for the gateway tier, and the
sibling of ADR-0014's `service.ts` / `viewmodel.ts` split in the feature tier:
one altitude per file.

Canonical layout (`gateways/icanhazdadjoke/`):

```
fetch-joke.ts        contract  — the public face: types + capability + re-export
fetch-joke-impl.ts   impl      — the orchestrator (call → classify → map)
client.ts            transport — upstream URL, headers, etiquette
mapper.ts            wire→domain quarantine (ADR-0005 §rule 2)
wire-types.ts        the raw wire shape
```

### 2. Contract and implementation are separate files, named by role

- **`<capability>.ts` is the contract**: the request type, the response type,
  their payload/error types, and the capability expressed as a **function
  type**. It is implementation-free — no HTTP, no JSON, no status handling. A
  reader gets the whole interface in one screen.
- **`<capability>-impl.ts` is the implementation**: the orchestrator, declared
  `const fooImplementation: Foo` so the compiler binds body to contract — the
  two cannot drift.
- **The contract re-exports the implementation** under the clean public name
  (`export { fetchJokeImplementation as fetchJoke }`), giving callers a
  **single import site**: function and types from the one module-named file.
  This was chosen over a type-only contract. The resulting `contract → impl`
  runtime edge is type-erased on the way back (the impl imports only the
  contract *type*), so it carries no cycle and no cold-start cost; and the
  re-export forwards **only the public capability** — `client` / `mapper` /
  parsing stay hidden — so it is a contract pointer, not the forwarding module
  ADR-0007 §1 warns against.
- **No OO interface.** The function type *is* the contract — the
  idiomatic-functional equivalent of an interface. We do not introduce
  `IFooGateway` classes or interfaces.

### 3. Composed files earn their place by role or substance, not line count

The implementation is composed of small files, each justified by an
**architectural role** even when it is tiny:

- **`client.ts`** — the transport bulkhead: the one place that knows the
  upstream URL, headers, and request etiquette. Kept separate even for a
  one-call gateway so "how we talk to the upstream" never leaks into the
  orchestrator.
- **`mapper.ts`** — the wire→domain quarantine (ADR-0005 §rule 2): the only
  file that reads upstream field names. Kept separate at two lines because the
  role, not the size, earns the file.
- **`wire-types.ts`** — the raw wire shape, named to distinguish it from the
  contract/domain types in `<capability>.ts`.

Fold a file into the orchestrator only when it has **neither** hidden substance
**nor** a role. This is the test that keeps all gateways uniform without
cargo-culting empty files.

### 4. REPR naming, gateway-qualified errors

- Contract types follow **REPR** (ADR-0007 §3): `<Verb><Noun>Request` and
  `<Verb><Noun>Response` — Response, never Result.
- **Error types are gateway-qualified** (`JokeGatewayError`, not
  `GatewayError`) so they read as something and cannot collide when two
  gateways' errors meet at a call site.

### 5. Inverted-pyramid ordering

Declare from **highest overview to lowest detail**, in contract files and in
governing docs (this ADR included):

> capability → request → response → response payloads/errors → wiring.

In `fetch-joke.ts`: `FetchJoke`, then `FetchJokeRequest`, `FetchJokeResponse`,
`Joke`, `JokeGatewayError`, then the re-export as the footer. TypeScript hoists
type aliases, so forward references are free — the ordering serves the reader,
not the compiler.

### 6. Comments state why, not what

The code carries the what/how; comments carry the **why** — the deliberately
coarse error surface, the quarantine, the upstream etiquette. Review scaffolding
(`FIX:` / `NOTE:` / `INFO:` markers) is removed before merge.

## Consequences

### Positive

- "Open the contract, see the whole interface" is now literally true: request,
  response, error surface — no plumbing.
- Cross-gateway name collisions become impossible; call sites read clearly.
- The earn-your-file test gives a non-cargo-cult reason for each file and keeps
  all gateways structurally uniform.
- The implementation is compiler-bound to its contract — the two cannot silently
  drift.

### Negative / trade-offs

- A gateway is now five files for what can be ~60 lines of logic. The split is
  deliberate (one altitude per file); the cost is more files to open.
- The `contract → impl` re-export reads as an inverted dependency — a contract
  importing its own implementation. It is type-erased-safe but aesthetically
  backward; the type-only alternative was rejected for its call-site ergonomic
  cost (two imports, and the function's path no longer the module-named file).
- **Amends ADR-0007.** The gateway public face is now named by **capability**
  and split into contract/impl, refining 0007's "module-named public file"
  convention; 0007's `gateways/metlink/metlink.ts` canonical example is
  **superseded** and awaits the rollout below.

### Deferred: metlink rollout and ADR consolidation

- **Rollout is pending.** Only `icanhazdadjoke` is converted. `metlink` — whose
  `client.ts` builds a query string and whose status taxonomy carries more
  substance — is the planned next application, and will confirm the pattern
  generalises before it is treated as settled.
- This is the fourth structural ADR in the 0005 / 0007 / 0014 / 0016 cluster,
  each amending the last. They are slated to **consolidate into a single living
  structural guide** once the broader refactor settles; until then this ADR
  stands as the amendment of record.

## References

- [ADR-0005](0005-worker-source-architecture.md) — gateway tier, wire-format quarantine (§rule 2), DI, testing posture
- [ADR-0007](0007-worker-architectural-pillars.md) — Deep Modules and the module-named public file convention amended here
- [ADR-0014](0014-layout-service-depth-and-context-slices.md) — the parallel contract/derivation split in the feature tier
- `gateways/icanhazdadjoke/` — the pilot
- #17 — idle_jokes content source these errors map to
