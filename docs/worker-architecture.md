# Worker Architecture

This is the **canonical guide** to how Worker code is built: the principles, the
patterns, and the reasons behind them. Read it first to understand _why_ the
code looks the way it does, then open the code for a working example.

**Code wins.** When the code and this guide disagree, the code is right and the
guide is stale — fix the guide. When this guide and an old ADR disagree, this
guide is right; the architectural ADRs that used to describe these patterns have
been folded in here. The only architecture ADR still live is
[ADR-0005](adr/0005-worker-source-architecture.md), which says _where code
lives_; this guide says _how to build it_.

Folder names and code symbols use the vocabulary in
[`glossary.md`](glossary.md) — that list is a contract, not a style preference.

---

## Pillars

Three ideas are the shared language for every architecture conversation about
`src/worker/`.

### Deep Modules

A module shows a **small surface** and hides a **lot of work** behind it. The
surface is the price every caller pays; the hidden work is the payoff. Aim for a
high payoff-to-price ratio.

- A module whose public function just forwards one call into a sibling file is a
  **pass-through** — it earns no keep. Give it real work or inline it.
- The point is information hiding: wire formats, wasm start-up, encoding,
  status-code taxonomies all stay behind the module's face.
- Best example in the tree: `gateways/metlink/` exposes one `fetchArrivals`
  function and hides HTTP, the wire shape, status classification, and the
  wire→domain mapping.

### Feature Folders

Code is grouped by **what it does for the product**, not by technical layer.
Each layout is one folder under `features/<layout>/`, and that folder is the
unit of growth — a new layout is a new folder, and nothing else has to move.

- **Features never import each other.** They are composed at a composition
  root, never by reaching into one another. Today that root is the frame
  registry (`features/frame-registry.ts`), which dispatches the `GET /v1/frame`
  request to the right feature; a future endpoint would bring its own.
- **Speculative sharing is the number-one cause of drift.** A helper used by one
  feature lives _in that feature_. It moves to `shared/` only when a _second_
  feature actually needs it — at the second use, not the first.
- The horizontal tiers (`api/`, `config/`, `gateways/`, `shared/`) are the
  **infrastructure** the features stand on, not where feature work grows.

### REPR (Request → Endpoint → Response)

A **capability boundary** names its contract with a `Request` type in and a
`Response` type out, and hides one narrow orchestrator behind it. REPR began as
an HTTP-API pattern (Steve Smith), and the HTTP endpoint is still its canonical
case — but in this codebase the _same discipline_ is applied at all three
capability boundaries:

| Boundary                     | Contract file                               | Request / Response types                               |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| **API endpoint** (canonical) | `api/frame.ts`                              | parsed `FrameRequest` → `Response`                     |
| **Gateway**                  | `gateways/metlink/fetch-arrivals.ts`        | `FetchArrivalsRequest` → `FetchArrivalsResponse`       |
| **Feature**                  | `features/idle_jokes/prepare-joke-frame.ts` | `PrepareJokeFrameRequest` → `PrepareJokeFrameResponse` |

So "a REPR contract" means the same thing everywhere: named request in, named
response out, one orchestrator, no plumbing on the public face. The Gateway and
Feature patterns below are both REPR contracts over a hidden composition.

---

## Cross-cutting postures

These hold everywhere in the Worker, across every tier.

### Dependency injection at the edge

`src/worker/index.ts` is the **only** file that constructs `new Date()` or reads
a Cloudflare binding. Everything downstream receives those as arguments —
`Date`, `Headers`, env secrets, KV bindings are all passed in.

_Why:_ every helper is testable in isolation with plain inputs, and "what can
this code touch?" is answered by its signature, not by reading its body.

### Wire-format quarantine

Only a gateway's `mapper.ts` ever reads an upstream's field names. The moment a
wire-format field name appears outside `gateways/<system>/`, the bulkhead is
leaking — stop and push it back in.

_Why:_ upstream quirks (Metlink field ordering, partial responses, timestamp
formats) stay sealed in one file. The rest of the code reads domain types and
never has to know.

### Testing and TDD

- Build with the **/tdd** rhythm: one RED test → one minimal GREEN → optional
  REFACTOR → next slice. Never bulk-write tests ahead of the implementation.
- **Unit tests** run in the Vitest workers-pool sandbox and cover pure-JS logic:
  domain helpers, view-model derivation, the BMP encoder, response/error
  shapers, gateway mappers. 
- **The raster pipeline cannot run in the sandbox.** Satori → resvg → BMP uses
  yoga-wasm, whose `WebAssembly.instantiate` is blocked in the workers-pool
  sandbox. So feature tests drive the _cheap_ path (view + version) through the
  public capability and stub the gateway; the full pixel pipeline is verified
  live with `wrangler dev` + curl.
- **Mock only at the system boundary** — the few places the Worker meets the
  outside world: `Headers`, `env` values (plain strings/objects), `Date` (a
  parameter), and each gateway's contract export. A new external system is a new
  gateway, so it falls under the same rule — the list grows with gateways, not
  with mock targets. _Why:_ those are the only real boundaries; everything else
  is our own code and should run for real, so tests exercise behaviour rather
  than a mock of it. Never mock Cloudflare runtime APIs; use them directly and
  verify them in the live integration check.

---

## Pattern: Gateway

Every external system — the Metlink API, a Cloudflare KV namespace, a jokes
service — is reached through a **gateway**: an in-process module shaped by _our_
needs, not the upstream's. The gateway owns the URL/binding, the request
etiquette, the wire format, and the failure taxonomy. Callers see only domain
types.

A gateway is the canonical Deep Module and a REPR contract over a hidden
composition. One folder, one public capability, the implementation split one
**altitude per file**.

**Reference implementations:**
- `gateways/metlink/` (an HTTP upstream),
- `gateways/public_holidays/` (a KV read — no wire shape, so no `wire-types.ts`).

```
fetch-arrivals.ts        contract   — the public face: types + capability + re-export
fetch-arrivals-impl.ts   impl       — orchestrator: call → classify → map
client.ts                transport  — upstream URL, headers, request etiquette
mapper.ts                quarantine — the only file that reads wire field names
wire-types.ts            wire shape — the raw upstream shape (omit if there is none)
```

Tests and `fixtures.ts` sit beside the files they cover.

**The contract file** (`fetch-arrivals.ts`) holds the request type, the response
type, their payload and error types, and the capability as a **function type** —
and nothing else. No HTTP, no JSON, no status handling. A reader gets the whole
interface on one screen.

**The implementation file** (`fetch-arrivals-impl.ts`) declares the orchestrator
bound to the contract type — `const fetchArrivalsImplementation: FetchArrivals`
— so the compiler keeps body and contract in lock-step.

**The contract re-exports the implementation** under the clean name:

```ts
export { fetchArrivalsImplementation as fetchArrivals } from "./fetch-arrivals-impl";
```

so callers get the function _and_ its types from one import.

**Error types are gateway-qualified** — `MetlinkGatewayError`, never a bare
`GatewayError` — so they read as something specific and two gateways' errors
can't collide at a call site. Gateways report failure **as data** (an
`{ ok: false; error }` union), not by throwing; deciding what a failure _means_
is the caller's job (see the Feature pattern).

**Declare from highest overview to lowest detail** (inverted pyramid):
capability → request → response → payload/error types → the re-export footer.
TypeScript hoists type aliases, so forward references are free; the order serves
the reader.

### Why this shape

- **Five files for ~60 lines of logic is deliberate.** Each file is one altitude
  (public face / orchestration / transport / mapping / wire shape). The cost is
  more files to open; the payoff is that "how we talk to the upstream" can never
  leak into mapping, and wire names can never leak past `mapper.ts`.
- **The contract re-exports its own impl**, which reads like a backwards
  dependency. It is chosen over a type-only contract because a type-only contract
  forces callers into two imports and moves the function off the
  capability-named path. The runtime edge is safe: the impl imports only the
  contract _type_, so it's type-erased — no real cycle, no cold-start cost. And
  the re-export forwards only the public capability; `client`, `mapper`, and
  parsing stay hidden, so it's a contract pointer, not a pass-through barrel.
- **No OO interface.** The function type _is_ the contract — the functional
  equivalent of an interface. We don't write `IFooGateway`.
- **`mapper.ts` and `client.ts` earn their files by role, not size.** Even a
  one-call gateway keeps them separate so the quarantine and the transport
  bulkhead each have exactly one home.

---

## Pattern: Feature

A **feature** is one folder under `features/` per layout key (`idle_jokes`,
`minimal_clock`, …). It produces the frame for a profile phase, and it is the
unit of both ownership and isolation: you should be able to understand one
feature without reading the rest of the app, and deleting a feature should mean
deleting its folder plus a small, _named_ residue.

A feature exposes **one REPR capability** that produces what its endpoint needs,
and is wired by the registry acting as composition root.

**Reference implementations:**

- `features/minimal_clock/` — the smallest: no gateway, no error policy.
- `features/idle_jokes/` — the canonical gateway-backed feature: one capability,
  one error policy.
- `features/priority_split/` — the non-trivial one: a parameterised gateway
  capability, a separate domain service, multiple targets, a test seam.
- `features/dual_month_calendar/` — the soft-miss one: a gateway failure
  degrades the frame instead of throwing.

### Files, named by role

These five are the minimum every feature has. The contract and impl are named
for the **capability**, not a fixed prefix (`<key>` is the layout key — the
folder name):

```
<capability>.ts        contract — REPR types + capability + re-export   (e.g. prepare-joke-frame.ts)
<capability>-impl.ts   impl     — (fetch → map →) derive → compose       (e.g. prepare-joke-frame-impl.ts)
viewmodel.ts           data     — the private view-model types + projections
view.tsx               pixels   — the renderer + LAYOUT_VERSION
<key>.test.ts          tests    — drive the public capability            (e.g. idle_jokes.test.ts)
```

A feature **earns more files** by role or substance (same rule as gateways), not
by line count:

```
errors.ts          policy  — problem factories + gateway-error → AppError mapping
domain-service.ts  derive  — substantial business logic + the domain-granularity test seam
mode-icon.tsx      pixels  — a sub-component of view.tsx
```

### The one capability

The whole public surface is one function — one REPR contract, returning what the
endpoint needs with the cheap parts up front. For the frame endpoint that is the
JSON `view` and the appearance `version`:

```ts
prepareJokeFrame(req: PrepareJokeFrameRequest): Promise<PrepareJokeFrameResponse>

type PrepareJokeFrameResponse = {
 view: Record<string, unknown>;          // JSON projection — diagnostics body + ETag input
 version: number;                         // appearance revision (LAYOUT_VERSION) — ETag input
 render: () => Promise<JokeRenderResult>; // frame-specific: deferred artefacts (see below)
};
```

The feature's internal state — the view model the renderer consumes — stays
**fully private**: no opaque tokens cross the surface, and no caller depends on
the feature's internal shapes.

**The deferred `render` closure is a frame-endpoint detail, not a feature law.**
It exists so the orchestrator can compute the ETag from `view` + `version` and,
on a conditional-request hit, return 304 without ever rasterising
(ADR-0013) — rasterisation is the one expensive step the 304 path must never
pay for. A future endpoint whose features have nothing expensive to skip would
just return its result directly. Defer only when there's a costly step worth
skipping; otherwise keep it simple.

### The request is the dependency manifest

The request type lists exactly what the feature needs:

- **Bound gateway capabilities**, declared in the feature's own words, importing
  only the gateway's _response_ type:

  ```ts
  export type JokeSource = () => Promise<FetchJokeResponse>;
  export type ArrivalsSource = (
    target: TransitTarget,
  ) => Promise<FetchArrivalsResponse>;
  ```

  The composition root binds transport (`fetch`, env bindings, config) when it
  wires the feature. The feature never sees `fetch`, `Env`, or a wire format —
  the quarantine reaches into the feature's _tests_, which stub domain-typed
  results, not HTTP responses.

- **Plain values it derives from**, in its own vocabulary: artefact flags
  (`includeBmp`, `includeSvg`), a clock (`now`), a timezone, the transit targets
  — and nothing more. Format negotiation is an API-tier concern; by the time a
  request reaches a feature it has collapsed into flags.

There is no shared context object. Each feature's request is its own type;
widening it is a reviewable diff at the feature _and_ at the wiring site.

### Failure policy: throw, or soft-miss

Gateways report failure as data; the feature turns that outcome into **policy**:

- **Throw** when the missing data _is_ the frame. `errors.ts` owns the problem
  factories and the gateway-error → `AppError` mapping; `prepare` (or its
  `render` closure) throws, and the API failure boundary turns the throw into
  problem+json. The response type stays success-shaped. (idle_jokes,
  priority_split.)
- **Soft-miss** when the missing data is _decoration_ **and a degraded
  experience is genuinely acceptable**. The impl logs a `warn`, substitutes a
  default, and renders a degraded-but-valid frame; the capability never throws
  and the feature has no `errors.ts`. (dual_month_calendar's public holidays: a
  KV miss yields an unshaded calendar, not an error frame.) A soft-miss must
  never be used to **bury a system error** — if something is actually broken,
  throw; only swallow a failure when the degraded result is a legitimate outcome.

The dividing question — _does the frame still mean what it should without this
data?_ — is the feature's to answer, at the one caller (the impl) that knows.
When in doubt, throw.

The `ProblemSlug` union in `shared/errors.ts` stays **closed**: it is the typed
mirror of the documented error catalog (`docs/api/errors.md`), so an undocumented
slug can't compile. A feature's slug line in that union is part of its named
deletion residue.

### Deleting a feature

Delete the folder, plus a small, _named_ residue: its binder entry in
`features/frame-registry.ts`, its line in the `ProblemSlug` union, and its entries in
the docs. Anything else left behind is a structure bug.

### Why this shape

- **The feature's internal state is private**, so the orchestrator handles no
  opaque tokens and depends on none of the feature's internal shapes.
- **Small structural types are spelled out per feature** (the render-result
  envelope, the prepared-frame shape) instead of imported from the registry.
  That is deliberate duplication, traded for severed coupling: a feature imports
  nothing from the tier that wires it, so reaching another feature's binding is
  impossible, not merely discouraged.
- **`domain-service.ts` is earned by substance**, and its test seam
  (`viewModelFromStopStates`) takes _gateway_ types, not wire payloads — so the
  feature's tests specify behaviour without the wire format ever entering them.

---

## Pattern: API endpoint

Each HTTP route is one self-contained handler under `api/<endpoint>.ts` — the
canonical REPR case. The handler receives a parsed, typed request (not the raw
`Request`), composes the work, and delegates wire-shaping to narrow response
shapers; it never constructs a `Response` inline.

**Reference implementation:** `api/frame.ts` (`GET /v1/frame`).

The frame orchestrator runs Request → Endpoint → Response in three visible
steps: authenticate and resolve the radiator; resolve the phase and ask the
feature to prepare the frame; then — only after the conditional-request check
misses — render the deferred artefacts and shape the negotiated format. ETag
derivation lives in `api/etag.ts` (`weakEtag`, `ifNoneMatchSatisfied`): features
expose the _inputs_ (`view`, `version`), the API tier owns the hash and the HTTP
semantics, so generation can never drift from validation.

---

## Conventions

The reasoning is the load-bearing part — judge edge cases against the reason, not
the rule.

- **Module-named public file, never `index.ts` barrels.** `fetch-arrivals.ts`,
  `lookup.ts`, `frame-registry.ts`. The only `index.ts` in the tree is
  the Worker entry. _Why:_ editor tabs stay informative, and barrels risk
  pulling wasm module-evaluation into every caller's eager-load graph
  (`shared/satori.ts` has hand-tuned lazy init precisely because that cost is
  real on Workers).

- **Response shapers carry a `*Response` suffix.** A function that builds an HTTP
  response _we return to our caller_ is suffixed `…Response`: `problemResponse`,
  `failureResponse`, `frameBmpResponse`, `frameSvgResponse`, `frameJsonResponse`,
  `frameNotModifiedResponse`, `notFoundResponse`. _Why:_ in a REPR tree the
  shaper is a named role; the suffix marks the terminal wire-shaping step at the
  call site and keeps it distinct from same-stem domain concepts. _Scope:_ the
  terminal per-variant leaf shapers only — orchestrators keep their verb
  (`shapeFrame` negotiates, then delegates), private helpers keep their job name
  (`frameBody`), and a gateway's `fetch*` is excluded because its `Response` is
  the _upstream's_, not ours. Content variants are named by _format_
  (`frameBmp` / `frameSvg` / `frameJson`), not status — 200 is the unmarked
  default; the one non-200, `frameNotModified`, names itself.

- **`lookup<X>(key)` vs `resolve<X>(inputs)`.** `lookup` is key → record (static
  config/registry access — could be a `Map.get()`). `resolve` is inputs →
  derived value via rules (time, content negotiation, profile phases). _Why:_ the
  verb tells the call site whether rules are running. `lookupRadiator(slug)` and
  `resolveProfilePhase(radiator, now)` carry different mental models.

- **Type-only cross-tier imports are allowed when they prevent invalid states.**
  `config/config-types.ts` type-imports `LayoutKey` from `features/frame-registry.ts`,
  so config can never name a layout that isn't implemented. The dependency is
  type-only and one-directional.

- **Failure variants stay narrow at the type layer.** `api/auth.ts`'s `auth()`
  returns `{ ok: true } | { ok: false }` — no `reason` field — so a missing token
  and a wrong token both collapse to `{ ok: false }`, exactly as the 401 contract
  intends. The type makes the missing-vs-invalid distinction structurally
  impossible to leak.

- **File headers are one or two lines: role + one non-obvious why.** Anything
  longer belongs in the architecture guide or an ADR. See
  [ADR-0016](adr/0016-file-header-comments.md) for the rule and anti-patterns.

---

## Heuristics (when → then)

Apply each only when its **when** becomes true; ignore it until then. Add a row
only _after_ a trigger has actually fired.

| When                                                                                | Then                                                                                                                               | Why                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A 2nd feature needs a helper that currently lives inside one feature folder         | Lift it to `shared/` as part of that 2nd feature's change                                                                          | Speculative sharing is the #1 cause of horizontal drift                     |
| `api/router.ts`'s `if`-ladder reaches 3+ endpoints                                  | Replace with a `{ method, path, handler }` table, or adopt Hono                                                                    | Make the convention self-enforcing instead of relying on reviewer vigilance |
| `features/frame-registry.ts` becomes a merge-conflict hotspot                       | Replace central registration with discovery (each feature exports a descriptor)                                                    | Centralisation cost rises super-linearly with feature count                 |
| A module's public file approaches ~80 lines, or its imports balloon                 | Split the **internals**, not the public surface                                                                                    | Depth beats breadth                                                         |
| A wire-format field name appears outside `gateways/<system>/`                       | Stop — the bulkhead is leaking; push it back into `mapper.ts`                                                                      | Mappers are the only file that knows the wire                               |
| A test needs a fixed clock                                                          | Promote `gateways/clock/` _then_, not before                                                                                       | Defaults stay light until they hurt                                         |
| A new external system is introduced                                                 | New folder under `gateways/` with the standard layout                                                                              | One gateway per system                                                      |
| A feature behaviour can only be reached by feeding wire payloads to a stubbed fetch | Export one named, domain-granularity seam from `domain-service.ts` and say why (e.g. `priority_split`'s `viewModelFromStopStates`) | The wire quarantine outranks single-entry purity                            |

---

## Anti-patterns we've rejected

- **`index.ts` barrels re-exporting wasm-bearing modules.** Cold-start risk on
  Workers.
- **Premature tier promotion.** Lifting code into a shared tier before a second
  consumer exists. (`mode-icon.tsx` was once in `shared/`; it now lives in
  `features/priority_split/`.)
- **Pass-through orchestrators.** A function whose body is a single dispatch into
  a sibling earns no depth. Grow it or inline it.
- **Reaching past a module's public face.** `import … from '../module/internal'`
  from another module. Convention today; lint enforcement is parked.
- **Bulk-writing tests ahead of implementation.** Use the /tdd rhythm.

---

## What this guide does not contain

When you need these, go to the source — not this doc — so it can't go stale:

- **The current directory tree** → `ls src/worker/`.
- **The current feature list** → `src/worker/features/frame-registry.ts` (`LayoutKey`
  is derived from it).
- **The current endpoint list** → `src/worker/api/router.ts`.
- **Where each tier lives and what it owns** →
  [ADR-0005](adr/0005-worker-source-architecture.md).
- **The wire contract** → [ADR-0003](adr/0003-radiator-worker-contract.md) +
  `docs/api/openapi.yaml`.
- **The error contract** → [ADR-0011](adr/0011-error-contract-problem-details.md)
  - `docs/api/errors.md`.
- **Conditional-frame (304) behaviour** →
  [ADR-0013](adr/0013-conditional-frame-requests.md).

If you find this guide describing something that belongs in one of those sources,
delete the description here and point at the source.
