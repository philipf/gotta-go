# Tracer: issue #4 minimal_clock frame via /v1/frame

> **Phase 1 (Worker, curl-testable)** — ✅ closed 2026-05-23 (see § *Slice walk*). **Phase 2 (firmware, hardware-testable)** — ✅ closed 2026-05-29 (see § *Firmware tracer (phase 2)*). Both halves now run end-to-end against the LilyGO T5 + a deployed Worker (or a cloudflared tunnel during dev).

## Context

Issue #4 (the "tracer" slice) is the first real implementation of the radiator ↔ Worker contract defined in [ADR-0003](../adr/0003-radiator-worker-contract.md) and [`docs/api/openapi.yaml`](../api/openapi.yaml). Originally split because the user was waiting on the LilyGO panel before firmware work could begin (#1 blocker). Phase 1 below covers the Worker ACs; phase 2 (added after #1 closed) covers the firmware ACs.

The existing PoC at `poc/worker/` proves the rendering pipeline (JSX → Satori SVG → resvg RGBA → 1-bit BMP → gzip) on Cloudflare Workers in production. It has zero auth, config, profile-phase resolution, or routing structure — it's a single `fetch` handler that always renders the same hardcoded `priority_split` test pattern. The PoC stays as historical reference; we don't evolve it.

This plan creates a fresh production Worker at `src/worker/` following the layout and conventions in [ADR-0005](../adr/0005-worker-source-architecture.md). The ADR fixes the directory shape, naming rules, gateway tier, deep-module/DI posture, and testing approach (TDD via the `/tdd` skill). This plan is the **#4-specific instantiation** of that architecture: which folders #4 actually creates, what to port from the PoC, and the slice-by-slice walk that delivers the Worker ACs.

## Scope for #4 (Worker phase)

Concretely, #4 creates the following Worker tiers — each named per ADR-0005 — and leaves the rest reserved-but-empty:

| ADR-0005 tier | What #4 creates                                        | What #4 leaves empty                             |
|---|---|---|
| `api/`          | `router.ts`, `frame.ts`, `format.ts`, `response.ts`, `errors.ts` | — |
| `features/`     | `minimal_clock/` with `index.ts`, `phase.ts`, `viewmodel.ts`, `bmp.tsx`, `minimal_clock.test.ts` | `json.ts` and `svg.tsx` (added by #19 / #20)     |
| `auth/`         | `index.ts`, `auth.test.ts`                             | — |
| `config/`       | `index.ts`, `data.ts`, `types.ts`, `config.test.ts`    | YAML/KV migration (deferred)                     |
| `schedule/`     | nothing — phase resolution lives inside `features/minimal_clock/phase.ts` while only one feature exists | The whole tier — promote to `schedule/` once a second feature forces the shared seam (#5). |
| `gateways/`     | nothing — `minimal_clock` has no upstream              | `metlink/` (#5+), `quotes/` (#17), `clock/` (when a test needs it) |
| `shared/`       | `satori/`, `bmp/`, `gzip/` ported from the PoC         | — |
| `assets/`       | `PressStart2P-Regular.ttf`, `assets.d.ts` copied from PoC | — |

ADR-0005 reserves a `schedule/` tier for "profile + now → phase / layout / sleep", but its own "Defaults stay light until they hurt" rule tells us not to populate that tier yet. While `minimal_clock` is the only feature in tree, the resolver is one tiny function with one caller, so it sits inside `features/minimal_clock/phase.ts`. When `priority_split` lands in #5 and a second feature needs the same lookup, lift `phase.ts` up to `schedule/` then — that promotion is the YAGNI exit gate, not the default.

`api/format.ts` for #4 returns `'bmp'` unconditionally — content negotiation per [ADR-0004](../adr/0004-diagnostics-view-content-negotiation.md) lights up when #19/#20 add the JSON/SVG renderers.

## Request flow for #4

```
GET /v1/frame
  X-Radiator-Slug: bedroom-philip-tania
  X-Radiator-Token: <secret>
  Accept-Encoding: gzip
  Accept: image/bmp                    ← #4 only handles image/bmp
        │
        ▼
src/worker/index.ts             → forwards to api/router.ts
        │
        ▼
api/router.ts                   → matches GET /v1/frame → api/frame.ts
        │
        ▼
api/frame.ts:
  1. auth.validate(headers, sharedToken)     → 401 (X-Sleep-Seconds: 3600) if token missing/invalid
  2. config.lookupRadiator(slug)             → 404 (X-Sleep-Seconds: 3600) if unknown slug
  3. pick layout                             → #4 only has 'minimal_clock'; api/frame dispatches directly
  4. feature.resolvePhase(profile, now)      → { phase, sleepSeconds }   (inside features/minimal_clock/)
  5. feature.buildViewModel(profile, now)    → { time, date, slug }
  6. api/format.ts                           → Accept: image/bmp → feature.renderers.bmp
  7. feature.renderers.bmp(viewmodel)        → Uint8Array (64,862-byte BMP)
  8. shared/gzip.gzip(bmp)                   → compressed bytes
  9. api/response.ts                         → Response with all headers from ADR-0003
        │
        ▼
200 OK
  Content-Type: image/bmp
  Content-Encoding: gzip
  X-Sleep-Seconds: <n> in [30, 14400]
  X-Server-Time: <ISO 8601 UTC>
  X-Profile-Phase: <phase key | idle_profile>
  <gzipped 1-bit BMP body>
```

## Public interfaces for #4

Per ADR-0005 (deep modules, DI, pure returns): each helper takes everything it needs as arguments and returns a value — no globals, no internal `new Date()`, no `process.env`.

```ts
// auth/index.ts
export type AuthResult = { ok: true } | { ok: false };
export function validate(headers: Headers, sharedToken: string): AuthResult;
// Note: the failure branch carries no Response so api/errors stays the sole
// owner of HTTP shaping. Missing vs invalid token are deliberately collapsed
// into a single { ok: false } variant per ADR-0003 (indistinguishable 401).

// config/index.ts
export type Profile = { slug: string; timezone: string; phases: Phase[] };
export function lookupRadiator(slug: string): Profile | undefined;

// features/minimal_clock/index.ts
export type ViewModel = { time: string; date: string; slug: string };
export type PhaseResolution = { phase: string; sleepSeconds: number };
export function resolvePhase(profile: Profile, now: Date): PhaseResolution;
export function buildViewModel(profile: Profile, now: Date): ViewModel;
export const renderers = { bmp: (vm: ViewModel) => Promise<Uint8Array> };
// Note: resolvePhase lives here (not under a top-level schedule/) until a
// second feature forces a shared seam — see "Scope for #4" above.
```

## What to port from the PoC

| Source (PoC) | Destination | Treatment |
|---|---|---|
| `poc/worker/src/bmp.ts` | `src/worker/shared/bmp/index.ts` | Verbatim port. Already pure-JS and standalone. |
| `poc/worker/src/render.ts` | `src/worker/shared/satori/index.ts` | Verbatim port, but import `pressStartTtf` from `../../assets/PressStart2P-Regular.ttf`. Keep the lazy-init pattern — it's the cold-start defence. |
| `poc/worker/src/PressStart2P-Regular.ttf` | `src/worker/assets/PressStart2P-Regular.ttf` | Copy. |
| `poc/worker/src/assets.d.ts` | `src/worker/assets/assets.d.ts` | Copy. |
| `poc/worker/src/layout.tsx` | **NOT ported** — that's the `priority_split` test pattern, deferred to #5/#6 | The new `features/minimal_clock/bmp.tsx` is a fresh JSX template (large `HH:MM`, small date below). |
| `poc/worker/wrangler.jsonc` | `src/worker/wrangler.jsonc` | Adapt: `main: "index.ts"` (relative to `src/worker/`), keep `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`, and the `rules` for `.ttf` bundling. |
| `poc/worker/package.json` | `src/worker/package.json` | Same deps (`satori`, `@resvg/resvg-wasm`), same devDeps (wrangler, vitest, etc.). |

## TDD slice order

Per ADR-0005 (testing approach) and the `/tdd` skill: tracer-bullet vertical slices, **one RED test → one GREEN minimal impl → optional REFACTOR → next slice**. Never bulk-write tests. Walk the rows top-to-bottom; do not skip ahead. Slice 0 (plumbing) is the only prerequisite; everything else is vertical.

| # | Slice | Test | Layer | Status |
|---|---|---|---|---|
| **0** | Repo plumbing: `package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`; copy TTF + `assets.d.ts`; `pnpm install` | — (no test; verified by `vitest --run` exiting 0 with no test files yet) | — | ✅ done (commit `95c6384`) |
| **1** | Port `shared/bmp` from PoC + its existing test | All-white RGBA encodes to a 64,862-byte BMP starting with `42 4d` | vitest | ✅ done |
| **2** | Port `shared/satori` from PoC verbatim (no test — sandbox blocks wasm; smoke-tested via slice 7) | — | — | ✅ done |
| **3** | `shared/gzip` | Round-trip: `gzip(bytes)` length < `bytes.length` for repetitive input | vitest | ✅ done |
| **4** | `config/data` + `config/lookupRadiator` | Tracer: `lookupRadiator('bedroom-philip-tania')` returns the seeded profile | vitest | ✅ done |
| **5** | `auth/validate` happy path | Matching token returns `{ ok: true }` | vitest | ✅ done |
| **6** | `features/minimal_clock/phase` (`resolvePhase`) happy path | All-day phase + any `now` returns `{ phase, sleepSeconds: <within [30,14400]> }` | vitest | ✅ done |
| **7** | `features/minimal_clock/viewmodel` (`buildViewModel`) happy path | Returns `{ time: matches /^\d{2}:\d{2}$/, date: matches /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/, slug }` | vitest | ✅ done |
| **8** | `api/errors` + `api/response` shapers | `unauthorized()` returns a `Response` with status 401, body "unauthorized", `X-Sleep-Seconds: 3600` | vitest | ✅ done |
| **9** | **Tracer bullet end-to-end**: wire `index.ts` → `api/router` → `api/frame` → all the above; deploy + curl | Happy-path curl returns 200, valid 64,862-byte BMP after gunzip, `X-Sleep-Seconds` present, `X-Server-Time` present, `X-Profile-Phase` present | `wrangler dev` curl | ✅ done |
| **10** | Missing token returns identical 401 to invalid token (no oracle) | Two curls (no token, wrong token); responses byte-identical except for `Date` header | vitest unit + curl | ✅ done |
| **11** | Unknown slug returns 404 with `X-Sleep-Seconds: 3600` and body "unknown radiator" | vitest unit + curl | ✅ done |
| **12** | Gzip negotiation: `Accept-Encoding: gzip` → `Content-Encoding: gzip` header + single-layer gzip body (GH #13 regression guard). Absent → uncompressed BMP is pinned at the unit layer only — `wrangler dev` normalises every inbound `Accept-Encoding` to `"br, gzip"`, so the raw branch is unreachable locally. | vitest unit + curl | ✅ done |
| **13** | Visual smoke: open the returned `frame.bmp` in an image viewer — clock reads current `HH:MM`, date is today | eyes | ✅ done |

After all slices are green, look for refactor candidates per `/tdd` refactoring guidance (duplication, shallow modules, primitive obsession). **No refactoring while RED.**

### Behaviors deliberately NOT tested in #4

- **Phase edge cases** (DST, phase boundary, multi-day rollover, idle-profile fall-through) — the seeded config has one all-day phase, so they're unreachable. Land with #5; that's also when `resolvePhase` lifts out of `features/minimal_clock/` into a shared `schedule/` tier.
- **Multiple Accept renderers** — only `image/bmp` matters; `api/format.resolveResponseFormat` returns `'bmp'` unconditionally. Property-test in #19/#20.
- **Cold-start retry semantics** — known PoC issue; the firmware client handles it per ADR-0003. Worker side has nothing to test.
- **Pixel-exact BMP correctness** — `shared/bmp` is byte-deterministic and inherited from a deployed PoC. Snapshot testing would just rehash the PoC's existing validation.

## Verification

All seven Worker ACs from issue #4 are curl-testable from a `wrangler dev` instance:

```bash
# Setup
cd <repo>/src/worker
echo "RADIATOR_SHARED_TOKEN=test-token-123" > .dev.vars
pnpm install
pnpm dlx wrangler dev
```

```bash
# AC1: token validation (both missing and invalid return identical 401)
curl -i -H "X-Radiator-Slug: bedroom-philip-tania" http://localhost:8787/v1/frame
# expect: 401, X-Sleep-Seconds: 3600, body "unauthorized"

curl -i -H "X-Radiator-Slug: bedroom-philip-tania" -H "X-Radiator-Token: wrong" http://localhost:8787/v1/frame
# expect: identical 401 response

# AC2: unknown slug
curl -i -H "X-Radiator-Slug: ghost" -H "X-Radiator-Token: test-token-123" http://localhost:8787/v1/frame
# expect: 404, X-Sleep-Seconds: 3600, body "unknown radiator"

# AC3+4+5+6: full happy path
curl -i -H "X-Radiator-Slug: bedroom-philip-tania" \
       -H "X-Radiator-Token: test-token-123" \
       -H "Accept-Encoding: gzip" \
       --compressed \
       --output frame.bmp \
       http://localhost:8787/v1/frame
# expect: 200, Content-Type: image/bmp, Content-Encoding: gzip,
#         X-Sleep-Seconds (30..14400), X-Server-Time (ISO 8601),
#         X-Profile-Phase set, body is a valid BMP

# AC4 (continued): verify BMP shape
stat -c %s frame.bmp     # expect 64862
xxd frame.bmp | head -1  # expect first two bytes "42 4d" (BM signature)
```

Plus the colocated unit tests:
```bash
pnpm test
# expect: auth/, config/, schedule/, minimal_clock/ tests all pass
```

## Firmware tracer (phase 2)

Added 2026-05-29 after #1 closed and ADR-0006 settled the toolchain. Walks the firmware-side ACs of #4 — F1 (request headers), F2 (Wi-Fi → BMP → panel → sleep), F3 (deployed Worker, panel renders correct local time).

### Scope for #4 (firmware)

| Concern | Where |
| --- | --- |
| Sketch | `src/radiator/radiator.ino` |
| Toolchain config | `src/radiator/sketch.yaml` (FQBN per [ADR-0006](../adr/0006-radiator-firmware-toolchain.md)), `src/radiator/mise.toml` |
| Secrets template | `src/radiator/secrets.example.h` (local `secrets.h` gitignored) |
| Vendored uzlib | `src/radiator/src/uzlib/` — registry has no `uzlib` package; vendored inflate-only files from upstream per [ADR-0008](../adr/0008-radiator-gzip-decompression.md) |
| Bring-up runbook | `src/radiator/README.md` |

Architectural decisions reused from phase 1 + ADR-0006 (toolchain) + new ADR-0008 (gzip in firmware).

### TDD-equivalent slice walk (firmware)

Firmware has no host-runnable test framework on this toolchain, so each slice is verified by `arduino-cli compile` + flash + serial log inspection rather than vitest.

| # | Slice | Verification | Status |
| --- | --- | --- | --- |
| **F0** | [ADR-0008](../adr/0008-radiator-gzip-decompression.md): pick uzlib for gzip-in-firmware | ADR merged | ✅ done |
| **F1** | Scaffold `src/radiator/` (sketch + sketch.yaml + mise.toml + .gitignore + secrets template + README) | `arduino-cli compile .` exits 0 | ✅ done |
| **F2** | Request headers (AC-F1): slug, token, `Accept-Encoding: gzip`, MAC as hardware-id | Worker logs `X-Profile-Phase: all_day_clock` → headers reached it | ✅ done |
| **F3** | Honour `X-Sleep-Seconds` with [1, 86400] clamp and 300 s firmware fallback (ADR-0003 table) | Serial: `sleeping 300 s (X-Sleep-Seconds)` | ✅ done |
| **F4** | Vendor uzlib + inflate compressed body | Serial: `inflate: ok 64862 bytes in N ms` | ✅ done |
| **F5** | BMP → 4bpp framebuffer → panel flush (ported from show-bmp-31) | Serial: `BMP: 960x540 1bpp …` + `panel: frame latched` | ✅ done |
| **F6** | Apply ADR-0003 response-handling table via `CycleResult` enum + `sleepFor()` dispatch | Each row maps to a labelled outcome in the cycle-summary log line | ✅ done |
| **F7** | cloudflared quick-tunnel runbook in `src/radiator/README.md` | `curl --http1.1` smoke test against the tunnel returns 200 + 516 B gzipped BMP | ✅ done |
| **F8** | Hardware verification (AC-F3) | Serial log shows full cycle + panel shows wall-clock `HH:MM` and date in Press Start 2P, time within 1 minute of host clock | ✅ done |

### Bugs surfaced during bring-up

Three real firmware bugs landed during flash-and-trace; none were contract issues — the Worker delivered the bytes ADR-0003 promised.

- **Read loop tripped `BodyTooLarge` on small bodies.** Cap was `total + stream->available() > MAX_COMPRESSED_BYTES`, but `available()` reports the TLS record-buffer size (~16 KB on mbedtls), not the response body. Switched to byte-at-a-time reads matching `poc/lilygo/wake-cycle-32`'s pattern; cap on bytes actually received.
- **HTTP/1.1 + chunked transfer broke `getSize()`.** cloudflared selected `Transfer-Encoding: chunked` and `https.getSize()` returned -1, forcing EOF detection onto connection-close. Added `https.useHTTP10(true)` to get a clean `Content-Length` + `Connection: close` response.
- **`uzlib_uncompress_chksum()` `res=0` was misread as failure.** `TINF_OK` (0) is returned when the destination buffer fills before the explicit gzip end-of-stream marker; only `< 0` is a real error. Widened the success check to accept both `TINF_OK` and `TINF_DONE`.

### Verification (hardware run)

```
=== GottaGo wake cycle #1 — wake reason: power-on / hard reset (cold boot) ===
Wi-Fi: connected in 100 ms — IP 192.168.50.59, RSSI -69 dBm
HTTPS: GET https://upon-prove-interest-nyc.trycloudflare.com/v1/frame
HTTPS: status 200, content-length 522, sleep=300 (1799 ms)
body: 523 bytes received (Content-Length=522)
inflate: ok 64862 bytes in 27 ms
BMP: 960x540 1bpp comp=0 offset=62 top-down
decode: ok in 42 ms
panel: frame latched
Cycle #1: outcome=ok, awake 5040 ms, sleeping 300 s (X-Sleep-Seconds)
```

Panel inspection: `HH:MM` and `Thu 28 May` rendered in Press Start 2P, no banding/artefacts/inversion, time within ~1 minute of host clock at the moment of `panel: frame latched`.

### Hand-off (for the next session)

If a future Claude session resumes this work or its follow-ups, the relevant state is:

- **The sketch is single-file.** `src/radiator/radiator.ino`, ~330 lines. Five source dependencies: WiFi, WiFiClientSecure, HTTPClient (ESP32 Arduino core 2.0.15), LilyGo-EPD47, and the vendored uzlib under `src/uzlib/`.
- **Compile/upload loop.** From inside `src/radiator/`: `arduino-cli compile .` → `arduino-cli upload -p /dev/ttyACM0 .` → `arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200`. If upload fails with *No serial data received*, park the board in ROM download mode (hold BOOT, tap RST, release, retry).
- **`secrets.h` is gitignored.** Template at `secrets.example.h`. The user's local copy carries Tui_2G Wi-Fi, a cloudflared tunnel URL (regenerates every `cloudflared tunnel --url …` invocation), `test-token-123`, and `bedroom-philip-tania`. The Wi-Fi block is the same as `poc/lilygo/wake-cycle-32/secrets.h`.
- **Local end-to-end run.** Two terminals: `pnpm dlx wrangler dev --local --port 8787` and `cloudflared tunnel --url http://localhost:8787` (cloudflared is AUR-only: `yay -S cloudflared`). Paste the printed `*.trycloudflare.com` URL into `FRAME_URL` + `/v1/frame`, re-flash.
- **ADRs that constrain the firmware.** [ADR-0001](../adr/0001-frame-transport-compression.md) (gzip is mandatory), [ADR-0003](../adr/0003-radiator-worker-contract.md) (wire contract + response-handling table), [ADR-0006](../adr/0006-radiator-firmware-toolchain.md) (arduino-cli + esp32@2.0.15 + LilyGo-EPD47@1.0.1), [ADR-0008](../adr/0008-radiator-gzip-decompression.md) (uzlib).

### Open items not blocking #4

Worth follow-up issues, but not gating the close of #4:

1. **Production deploy (#12).** The cloudflared tunnel is throwaway — dies when the process exits. A radiator running steady-state needs a stable URL. Either `wrangler deploy` to a workers.dev subdomain or wait for #12 to land the full multi-radiator rollout.
2. **TLS certificate pinning.** `client.setInsecure()` matches PoC #32 and the README's *What this firmware does NOT do* list. Production radiator should pin or bundle the CA for the Worker host.
3. **1-byte tail-drain overcount.** Read loop occasionally reads 1 byte past `Content-Length` (e.g. 523 received with CL=522). Harmless — uzlib stops at the gzip end marker — but a strict-bound loop would be tidier.
4. **uzlib vendored, not pinned to a tagged release.** Tracked under ADR-0008's *Negative consequences*. If the vendored tree becomes a sustained dependency, capture upstream commit `6d60d65` (pfalcon/uzlib) in `src/radiator/src/uzlib/VENDORED.md` so the provenance survives.
5. **Wake-to-sleep baseline.** First-cycle run reported 5,040 ms (TLS handshake-heavy at 1,799 ms). Battery accounting from PRD §7 needs this translated to mAh via a power meter — out of scope for #4 but the number is the starting baseline.

## Out of scope (deferred to other issues)

- **JSON renderer for `minimal_clock`** — issue #19.
- **SVG renderer for `minimal_clock`** — issue #20.
- **`priority_split` feature** — issues #5, #6 (with Metlink, KV cache).
- **`idle` profile** — issue #17.
- **`gateways/metlink/` (Fowler gateway: client, mapper, cache, fixtures)** — issues #5+.
- **`gateways/quotes/` or similar for idle profile content** — issue #17.
- **`gateways/clock/` (RealClock / FixedClock)** — introduce only when a test needs a fixed clock.
- **Migration of config from TypeScript to YAML/KV** — defer until schema stabilises.
- **Multi-phase schedule logic** — for the tracer, one all-day phase is enough to verify the resolution code path; richer schedules land with #5, at which point `phase.ts` is promoted from `features/minimal_clock/` to a top-level `schedule/` tier (per ADR-0005's "Defaults stay light until they hurt").
- **Real production deploy + secret management** — issue #12 covers the multi-radiator rollout. **#4's Worker work ends at `wrangler dev` validation**; deploy lands when the firmware needs it.

## References

- [ADR-0003](../adr/0003-radiator-worker-contract.md) — radiator ↔ Worker contract (endpoint, headers, status codes, sleep-seconds range)
- [ADR-0004](../adr/0004-diagnostics-view-content-negotiation.md) — `Accept`-based content negotiation; #4 only handles `image/bmp`
- [ADR-0005](../adr/0005-worker-source-architecture.md) — directory layout, gateway tier, deep-modules + DI, TDD posture
- [`docs/api/openapi.yaml`](../api/openapi.yaml) — wire spec the Worker implements
- `/tdd` skill — testing rhythm for every slice
