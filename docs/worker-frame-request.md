# Worker — `GET /v1/frame` request flow

Sequence diagram and component map for the production worker at [`src/worker/`](../src/worker/). Use this to orient before jumping into the code.

## Sequence diagram

Happy path only — auth/slug failures, gzip negotiation, and the render-pipeline internals are covered in the component map below.

```mermaid
sequenceDiagram
    autonumber
    participant R as Radiator firmware
    participant W as Worker (api/frame.handleFrame)
    participant A as auth.validate
    participant C as config.lookupRadiator
    participant S as schedule.resolveProfilePhase
    participant N as api.resolveResponseFormat
    participant L as features.registry (layouts[layout])
    participant V as minimal_clock.buildViewModel
    participant F as minimal_clock.renderBmp

    R->>W: GET /v1/frame
    W->>A: validate(headers, sharedToken)
    A-->>W: ok
    W->>C: lookupRadiator(slug)
    C-->>W: Radiator (slug + profile)
    W->>S: resolveProfilePhase(radiator, now)
    S-->>W: { profilePhase, layout, sleepSeconds }
    W->>N: resolveResponseFormat(Accept)
    N-->>W: 'bmp'
    W->>L: layouts[layout](radiator, GLOBAL.timezone, now, 'bmp')
    L->>V: buildViewModel(radiator, timezone, now)
    V-->>L: { slug, time, date }
    L->>F: renderBmp(vm)
    F-->>L: BMP bytes
    L-->>W: BMP bytes
    W-->>R: 200 image/bmp + sleep/phase/server-time headers
```

## Component map

### Edge & routing

- **`index.ts`** — Worker entry. Calls `route(request, env, new Date())`. The `new Date()` injection point is the only place "now" enters the system; everything downstream takes `now: Date` as a parameter, which keeps schedule/viewmodel logic trivially testable.
- **`api/router.ts`** — Single-route dispatcher. Matches `GET /v1/frame` → `handleFrame`; everything else → `notFound()` from `api/errors.ts`. Knows zero domain.
- **`api/frame.ts` (`handleFrame`)** — The only "thick" function in `api/`. It orchestrates the slice: auth → config → schedule → registry dispatch → gzip → response. If you're looking for "what happens on a frame request", start here.

### Gatekeeping

- **`auth/validate.ts` (`validate`)** — Constant-comparison of `X-Radiator-Token` against `env.RADIATOR_SHARED_TOKEN`. Returns a deliberately opaque `{ ok: boolean }` — missing-token and wrong-token are indistinguishable on the wire (per the OpenAPI contract).
- **`config/lookup.ts` (`lookupRadiator`)** — Resolves a slug to a fully populated `Radiator` (slug + inlined profile) by joining the `RADIATOR_REFS` map (slug → profile-name) against the `PROFILES` map. Fails closed on a dangling profile-name reference.
- **`config/data.ts`** — Three exports mirroring PRD §9: `GLOBAL` (timezone + default refresh), `PROFILES` (named profiles), `RADIATOR_REFS` (slug → profile-name). Future per-radiator config (display capabilities, etc.) attaches to the radiator reference here.
- **`config/types.ts`** — `Global`, `Radiator`, `Profile`, `ProfilePhase` types. Type-only imports `LayoutKey` from `features/registry` so the layout union can't drift from the registered set.

### Schedule

- **`schedule/resolve.ts` (`resolveProfilePhase`)** — Picks the active **profile phase** from the radiator's profile and clamps `refreshIntervalMinutes × 60` into `[30, 14400]` seconds. The PoC config seeds a single all-day phase, so resolution is trivial. Returns `{ profilePhase, layout, sleepSeconds }` — the orchestrator uses `layout` to index the registry, `profilePhase` for the `X-Profile-Phase` response header, and `sleepSeconds` for `X-Sleep-Seconds`. Multi-phase logic + DST land in a follow-up.

### Feature dispatch

- **`features/registry.ts`** — Declares `layouts` (a `LayoutKey → render` map) and derives `LayoutKey = keyof typeof layouts`. Adding a layout = registering it here; the type follows automatically. Today: `{ minimal_clock: minimalClockRender }`.

### Per feature (`minimal_clock`)

- **`features/minimal_clock/service.ts` (`render`)** — Single public entry point: `async render(radiator, timezone, now, format) → Promise<Uint8Array>`. Internally holds a `Record<ResponseFormat, …>` renderer map keyed on the `ResponseFormat` union, so adding a new format surfaces a TypeScript error here until a renderer is supplied. When `json` / `svg` outputs land (#19 / #20) they slot in alongside `bmp`.
- **`features/minimal_clock/viewmodel.ts` (`buildViewModel`)** — Pure presentation: formats `time` (`HH:MM`, 24h, en-GB) and `date` (`Dow DD Mon`) in the supplied timezone via `Intl.DateTimeFormat`, with a per-tz formatter cache so we don't rebuild per request. No date library.
- **`features/minimal_clock/bmp.tsx` (`renderBmp`)** — The renderer for `image/bmp`. Builds the JSX layout (centered time + date in DejaVu Sans Bold), then walks the three-stage pipeline: JSX → SVG → RGBA → 1-bpp BMP.

### Content negotiation

- **`api/format.ts` (`resolveResponseFormat`)** — Accept header → response format. Today it unconditionally returns `'bmp'`. Stub on purpose; ADR-0004 specifies the `json` / `svg` branches that arrive with later issues.

### Render pipeline (shared)

- **`shared/satori.ts`** — The crown jewel of cold-start defence. Three things to know:
  1. `import satori, { init as initSatori } from 'satori/standalone'` — the standalone entry does **not** auto-fire yoga's WASM compile on module load (GH #14).
  2. `yoga.wasm` and resvg's `index_bg.wasm` are imported as values; wrangler/esbuild treat them as `WebAssembly.Module`s pre-compiled at deploy time.
  3. `ensureWasm()` is a per-isolate memoized `Promise.all([initSatori(yogaWasm), initResvg(resvgWasm)])` — both wasms instantiate lazily, in parallel, exactly once.

  Exposes `jsxToSvg(tree)` and `svgToRgba(svg)`. Both `await ensureWasm()` before doing work.
- **`shared/bmp.ts` (`rgbaTo1BitBmp`)** — RGBA → 1-bpp BMP1 encoder. Luminance threshold 128 (with alpha-over-white compositing), top-down (negative height), BI_RGB (no compression). Emits the 14-byte file header + 40-byte DIB + 8-byte 2-colour palette + packed bit rows. Output is a constant 64 862 bytes at 960×540. Also the single source of truth for `WIDTH` / `HEIGHT`.

### Wire-level encoding

- **`shared/gzip.ts`** — Thin `CompressionStream('gzip')` wrapper. Only invoked when the client advertises gzip. Returns ~1.5 KB for our 64 862-byte BMP (≈40× saving).
- **`api/response.ts` (`frameOk`)** — Final response shaper. Sets `Content-Type: image/bmp` and the three ADR-0003 observability headers (`X-Sleep-Seconds`, `X-Server-Time`, `X-Profile-Phase`). When `gzip=true`, also sets `Content-Encoding: gzip` **and** the non-standard `encodeBody: 'manual'` — that flag is the GH #13 fix and tells the Workers runtime "the body is already encoded, don't re-gzip it." The two settings are bound to the same boolean so they cannot drift apart.

### Errors

- **`api/errors.ts`** — Three shapers:
  - `unauthorized()` (401) and `unknownRadiator()` (404) — both set `X-Sleep-Seconds: 3600` (the firmware backs off for an hour on auth/slug failures) and `X-Profile-Phase: none`. Bodies are short lowercase strings the firmware ignores.
  - `notFound()` (404) — bare router-level 404 for an unknown path. No contract headers — the radiator only ever hits `/v1/frame`, so this branch is a developer/curl condition; firmware falls back to its built-in default sleep if it ever hits this.

## Mental shortcut

> A frame request is **gate → resolve → dispatch → render → encode → shape**.
> Gate in `auth/` + `config/`. Resolve in `schedule/`. Dispatch via `features/registry` (layout key → render). Render via the feature's `service.render()` (which composes its viewmodel + per-format renderer). Encode in `shared/gzip`. Shape in `api/response`.
> The two non-obvious bits — `satori/standalone` + memoized `ensureWasm` ([#14](https://github.com/philipf/gotta-go/issues/14)), and `encodeBody: 'manual'` ([#13](https://github.com/philipf/gotta-go/issues/13)) — both have inline comments pointing at the GitHub issues.
