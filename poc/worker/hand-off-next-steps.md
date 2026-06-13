# Hand-off: `worker` PoC → next PoC

**Read first:** [`plan.md`](./plan.md) — five-iteration plan with deviation notes embedded against each checkbox.
**Context:** [`../to-bmp/hand-off-next-steps.md`](../to-bmp/hand-off-next-steps.md) — predecessor PoC; sets the BMP encoder, font, and resvg-wasm decisions this PoC inherited.
PRD: [`../../docs/PRD/GottaGo PRD.md`](../../docs/PRD/GottaGo%20PRD.md). Glossary: [`../../docs/glossary.md`](../../docs/glossary.md).

## What this PoC proved

**End-to-end JSX → SVG → BMP pipeline runs on Cloudflare Workers production.**

```
HTTP GET / ─► satori(JSX, fonts)
           ─► SVG string
           ─► resvg-wasm.render() (RGBA)
           ─► luminance threshold + bit-pack
           ─► 1-bit BMP (64 862 B)
           ─► gzip via CompressionStream (1 586 B, when Accept-Encoding: gzip)
           ─► Response(image/bmp [+ content-encoding: gzip], x-sleep-seconds: 120)
```

Deployed at <https://gotta-go-worker.philip-fourie-4ad.workers.dev>.

Verified in **production** (not just `wrangler dev`):

- Static `.wasm` and `.ttf` imports bundle correctly and load once per isolate.
- Satori + yoga-wasm + resvg-wasm + node-compat shims all coexist inside one Worker.
- Response body is a valid BMP1 — magic bytes `42 4d`, 64 862 bytes, `magick frame.bmp frame.png` produces a recognisable two-column layout matching the `to-bmp` reference (~4.7% pixel diff, sub-pixel font-edge variance only — layout/text/lines/markers identical).
- `x-sleep-seconds: 120` header present on every successful response.
- **Gzip transport** (ADR-0001): clients sending `Accept-Encoding: gzip` receive a single-layer gzip wire body with `Content-Encoding: gzip`; clients without it receive the raw 64 862 B BMP. See decisions table for the `encodeBody: 'manual'` quirk.

### Performance (production, Wellington PoP)

| Metric | Value | Notes |
|---|---|---|
| Worker upload size | 3 456 KiB (1 202 KiB gzip) | Wrangler `Total Upload` — excludes source map. Slightly over the 3 MiB target; see below. |
| Worker startup time | 34–46 ms | Reported by `wrangler deploy`. |
| Warm TTFB | median ~98 ms, p90 ~210 ms (n=20) | Single Wellington PoP, after one warm-up request. Pre-gzip baseline; gzip path measured separately below. |
| Server-side wallTime (warm) | 53–87 ms (raw) / 47–64 ms (gzip path, n=8) | From `wrangler tail` `wallTime` field. Gzip cost ≤ 5 ms — within sampling noise of the raw baseline, consistent with the ADR-0001 1–5 ms estimate. |
| Wire body — raw BMP | 64 862 B | Sent when the client omits `Accept-Encoding: gzip`. |
| Wire body — gzip | **1 586 B** | Sent when the client sends `Accept-Encoding: gzip`. **40.9× smaller** than the raw BMP — better than the ADR estimate of 5–13 KB. Single-layer gzip, decompresses cleanly with one `gunzip`. |
| **Cold-start reliability** | **The first 1–3 requests on a freshly-deployed isolate return HTTP 500** (see "Open issues" below) | Subsequent requests succeed and stabilise within ~100 ms TTFB. |
| Visual fidelity vs `to-bmp/out.bmp` | ~4.7% pixel diff (24 406/518 400 px) | All differences are sub-pixel font-edge rendering between resvg's text shaping inputs (Satori SVG vs hand-rolled SVG). |

### Bundle composition (`dist/` after `wrangler deploy --dry-run`)

| File | Size | Notes |
|---|---|---|
| `index_bg.wasm` | 2.4 MiB | resvg-wasm — dominant cost, unavoidable. |
| `index.js` | 921 KiB | Bundled Satori + react/jsx-runtime + the worker code. |
| `PressStart2P-Regular.ttf` | 116 KiB | Bundled via `rules: [{ type: "Data" }]` in `wrangler.jsonc`. |

Yoga-wasm (Satori's layout engine) is ~88 KiB and lives **inside** `index.js` as a base64 string — that's where most of the JS bundle weight comes from.

## Decisions made (and why) — don't redo these

| Decision | Why | Where to revisit |
|---|---|---|
| **`nodejs_compat` compatibility flag** | Satori's transitive deps reference `process` at module-load — without the polyfill the Worker fails to instantiate at all | Never — keep the flag |
| **`"jsx": "react-jsx"` + React 19 + `@types/react`** | Satori needs JSX; React 19 dropped the global `JSX` namespace, so component signatures use `ReactNode` from `react`, not `JSX.Element` | Only if Satori ships its own JSX types |
| **TTF bundled via wrangler `rules` Data loader** | Wrangler natively bundles `.wasm` but not `.ttf`; the `rules` entry lets `import font from './foo.ttf'` give an `ArrayBuffer` | If wrangler ever bundles `.ttf` natively |
| **Single shared `fontBuffer = new Uint8Array(pressStartTtf)`** | Passed to both `satori()` and `Resvg()`; ensures both engines see the exact same bytes | Never |
| **Lazy `wasmReady ??= initWasm(...)` for resvg** | Cloudflare top-level code runs once per isolate; this initialises wasm on first use and amortises across all requests on that isolate | Considered top-level `await` instead, but resvg's init is cheap enough that the lazy pattern is fine. Doesn't help yoga-wasm — see "Open issues" |
| **Panel-local coordinates with `position: absolute`** | Satori uses CSS top-left positioning; SVG `<text y=N>` is the baseline. The `Txt` helper takes panel-local `(left, baseline, size)` and emits `top: baseline - size`. See `src/layout.tsx` | Layout PoC will own real layout — this is just enough to validate the pipeline |
| **Pure-encoder unit test only; pipeline validated via deploy gate** | `@cloudflare/vitest-pool-workers` sandbox blocks runtime `WebAssembly.instantiate`, which Satori's yoga-wasm needs. Wrangler dev + prod both allow it | If a satori-compatible vitest pool ever ships, restore an integration test |
| **`CompressionStream('gzip')` + `encodeBody: 'manual'` for the compressed branch** | ADR-0001 requires `Content-Encoding: gzip` on the wire. The Workers runtime's `Response.encodeBody` defaults to `"automatic"`, which re-applies gzip when it sees `Content-Encoding: gzip` — the result is a double-gzipped wire body (see [#13](https://github.com/philipf/gotta-go/issues/13)). `encodeBody: 'manual'` tells the runtime the body is already encoded. `Cache-Control: no-transform`, explicit `Content-Length`, and `Content-Encoding: deflate` do **not** fix this — only `encodeBody: 'manual'` does. | Never; the field is stable Workers API |
| **Conditional gzip on `Accept-Encoding`** | The radiator will always send `Accept-Encoding: gzip` per ADR-0001, but the raw branch keeps the worker debuggable from any HTTP client. `Content-Type: image/bmp` is preserved on both branches. | Could be made unconditional once the radiator path is proven; ADR-0001 doesn't require the raw branch |

## What's in this directory

| File | Purpose |
|---|---|
| `plan.md` | Five-iteration plan with checkboxes ticked and deviation notes per iteration |
| `wrangler.jsonc` | Worker config — `nodejs_compat` flag, `Data` loader rule for `*.ttf` |
| `src/index.ts` | Request handler — composes JSX → SVG → RGBA → BMP, branches on `Accept-Encoding: gzip` (gzip via `CompressionStream`, `encodeBody: 'manual'`), returns response with `x-sleep-seconds: 120` |
| `src/bmp.ts` | Pure-JS 1-bit BMP encoder, ported verbatim from `to-bmp/index.ts` |
| `src/render.ts` | Lazy `initWasm` pattern, `jsxToSvg`, `svgToRgba`. Single shared font buffer |
| `src/layout.tsx` | `Panel` + `Txt` components, `buildLayout()`. Mirrors `to-bmp/input.svg` |
| `src/pattern.ts` | Iter-2 checkerboard generator. **Unused.** Delete when starting next PoC |
| `src/assets.d.ts` | Ambient module declarations for `*.wasm` (`WebAssembly.Module`) and `*.ttf` (`ArrayBuffer`) |
| `src/PressStart2P-Regular.ttf` | Production font (118 KB, OFL) — same file as `to-bmp/` |
| `test/index.spec.ts` | Pure-encoder unit test; see decisions table for why no integration test |

Re-run locally: `mise install && pnpm install && pnpm wrangler dev`.
Deploy: `pnpm wrangler deploy`.

## Open issues / questions deliberately deferred

### 1. Cold-start hung-worker cancellation — **needs handling in the next PoC**

The first 1–3 requests on a freshly-deployed isolate return HTTP 500. From `wrangler tail`:

> "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response."

CPU time on the failing request: ~97 ms, wallTime ~102 ms. The runtime can't tell synchronous wasm compilation/instantiation from an infinite loop, so it cancels the request. Once the isolate has compiled wasm modules (resvg + yoga), subsequent requests run normally in ~100 ms.

Reproduction: `pnpm wrangler deploy && for i in 1 2 3 4 5; do curl -sS -o /tmp/t -w "%{http_code}\n" $URL; done` — first run usually shows two or three `500`s then `200`s.

**Impact on the radiator:** the device polls every 120 s. Cold-isolate misses will produce blank/stale frames. Cloudflare keeps isolates warm for many minutes under traffic, so steady-state is fine, but every deploy and every idle period creates a risk window.

**Mitigations the next PoC should consider:**

- **Client-side retry on 5xx** (probably 1 retry with 200–500 ms backoff). Cheap, robust, defends against more than just this failure mode. **This is the recommended first move** — solves the problem without touching the Worker.
- **Top-level `await ensureWasm()`** in `src/render.ts` so resvg's wasm compiles during Worker startup time (CF allows up to 400 ms there) rather than during the first request. Worth trying. Won't help yoga-wasm — Satori loads that lazily on first `satori()` call.
- **Pre-warming yoga-wasm at top level** by calling `satori(<empty/>, {...})` at module load. Increases startup time, might exceed the 400 ms budget. Untested.
- **Splitting the request handler with `scheduler.wait(0)`** between wasm operations to give the runtime yield points. Unproven; would need experimentation.

### 2. Bundle slightly over 3 MiB target

3 456 KiB upload vs 3 MiB target. The wasm alone is 2.4 MiB. We're well under the free-tier 10 MiB limit, but the original budget was set assuming smaller deps. Re-tighten the target or accept the new floor — recommend the latter; resvg-wasm is the bottleneck and there's no smaller equivalent.

### 3. Real hardware row order — still unverified

`biHeight = -540` (top-down) inherited from `to-bmp`. The LilyGO panel firmware PoC will confirm or flip it. If it renders upside-down, change the sign and reverse the loop in `rgbaTo1BitBmp()`.

### 4. Profile-phase logic (real `x-sleep-seconds`)

Hardcoded to `120` here per plan scope. The PRD's profile-phase scheduling — different sleep intervals for AM commute / midday / PM commute / overnight — belongs to a later PoC once the device side exists.

### 5. KV caching, Metlink integration, auth headers

All out of scope per `plan.md`. The radiator PoC and the Metlink PoC own these.

### 6. `wrangler dev` always negotiates gzip — dev-only quirk

miniflare/`wrangler dev` injects `Accept-Encoding: gzip` into every incoming request to emulate the CF edge, so the worker always enters the compressed branch locally. This means:

- `curl localhost:8787` returns a 1 586 B gzip blob, not a 64 862 B BMP — naive inspectors will be confused. Use `curl --compressed` to decompress, or `-H "Accept-Encoding: gzip"` to capture the raw wire bytes.
- Two of the five Iter-6 local-gate checks (byte identity, raw-branch headers) are unreachable in dev and are only verifiable against the deployed worker.

The README documents this. The worker code is unchanged by this — it's purely an emulation behaviour difference.

## Next PoC — `radiator` (recommended scope)

**Goal:** prove the LilyGO T5 panel can fetch a BMP from this Worker, render it, and sleep for `x-sleep-seconds`. End-to-end on real hardware.

### Concrete first steps

1. **Send `Accept-Encoding: gzip` on the fetch and decompress the response** (ADR-0001). Most ESP-IDF HTTP clients handle this transparently when you set the header; link against the bundled zlib or miniz (~10 KB code). Skip this and the radiator gets the 64 862 B uncompressed BMP — functional but burns ~5× more Wi-Fi radio-on time per wake. Empirical wire size is 1 586 B (better than the 5–13 KB ADR estimate).
2. **Implement client-side retry on 5xx.** One retry, 250 ms backoff. Defends against the cold-isolate hung-worker issue documented above.
3. **Confirm row order** by displaying `out.bmp` (or a synthetic top/bottom marker BMP) and verifying which edge appears at the top of the panel. If inverted, fix `to-bmp/index.ts` and `worker/src/bmp.ts` together.
4. **Measure end-to-end latency** wake → fetch → render → sleep. The 120 s `x-sleep-seconds` budget assumes everything fits in well under 1 s of awake-radio time.
5. **Implement `x-sleep-seconds` parsing and `esp_sleep_enable_timer_wakeup()`** call. Honour the header exactly; don't second-guess it client-side.

### Deferred to later PoCs (do not bundle into the radiator PoC)

- `X-Radiator-Slug` / `X-Radiator-Token` auth (security PoC)
- Profile-phase `x-sleep-seconds` logic on the Worker side
- Metlink API integration (already has `poc/metlink/`)
- KV caching of rendered frames

## Likely traps for the next agent

- **Don't expect the Worker to be reliable on the first hit after deploy.** It isn't. Build retry into the client. The cold-start 500 is the single most important finding from this PoC.
- **Don't try to run the Satori path under `vitest-pool-workers`.** The sandbox blocks runtime `WebAssembly.instantiate`. Use the unit test for the encoder, validate the rest via the deploy gate.
- **Don't drop `nodejs_compat`.** The Worker won't load without it — Satori's transitive deps reference `process` at module load.
- **Don't change the font family string.** Both `satori()` and `Resvg()` must see `"Press Start 2P"` exactly. resvg silently drops text on family-name mismatch.
- **Don't refactor the `Txt` helper without understanding the coordinate transform.** Satori = CSS top-left; SVG `<text>` = baseline. The `top: baseline - size` offset is load-bearing.
- **Don't add binary deps without considering the wasm budget.** We're at 3.4 MiB upload. Free-tier ceiling is 10 MiB, but every extra MiB widens the cold-start window.
- **Don't use `npm`.** `pnpm` per toolchain convention. `mise install && pnpm install`.
- **Don't remove `encodeBody: 'manual'`** from the compressed branch in `src/index.ts`. Without it, the Workers runtime re-applies gzip on top of our already-compressed body, producing an undecodable double-gzipped wire body. The fix is non-obvious — none of `Cache-Control: no-transform`, explicit `Content-Length`, or stream-vs-buffer return paths address it. See [#13](https://github.com/philipf/gotta-go/issues/13) for the full investigation.
- **Don't trust `wrangler dev` to exercise the raw-BMP branch.** miniflare injects `Accept-Encoding: gzip` into every request, so the worker always compresses locally. Use the deployed worker to verify the raw branch and the byte-identity check.
