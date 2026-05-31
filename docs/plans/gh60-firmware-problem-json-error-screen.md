# GH #60 — Firmware: render the `problem+json` error screen

> Status: ✅ done (commits A–E on branch `feat/60-firmware-problem-json-error-screen` off `main`).
> Code compiles clean at every commit. On-panel human verification passed: happy-path
> re-render (Commit B), Fatal 401 + Retryable 502 error screens (Commit C/D), and the
> verbose on/off `upstream_detail` pass — all confirmed on the physical device.
> Scope: `src/radiator/` only — `radiator.ino`, `settings.example.h`, `settings.h.prod`,
> the (gitignored, local) `settings.h`, and `README.md`. **No worker changes** — the
> worker already emits `problem+json` (landed in #59, commit `c387c3d`).
> Issue: <https://github.com/philipf/gotta-go/issues/60> (parent design: #56; contract: #58).

This plan is written to be handed to an agent that has **only** this file and the linked
issue — no other context. Everything decided in the design session is captured below,
including the rationale, so you should not need to re-derive any choices. When a step needs
a physical device or a human to do something the agent cannot, it is marked **👤 HUMAN STEP**.

---

## Why

Today the firmware follows ADR-0003's old rule: on any non-2xx it leaves the panel showing
the last good frame and just sleeps (`radiator.ino`, `CycleResult::HttpError`). #56 showed
this hides real failures — a bad `METLINK_API_KEY` looks identical to "a quiet evening with
no buses." **ADR-0011** (`docs/adr/0011-error-contract-problem-details.md`) settled the fix:
the Worker now returns an RFC 9457 `application/problem+json` document on every error, and
the firmware must render a **generic on-panel error screen** from it instead of silently
holding the last frame. This is a deliberate, scoped relaxation of "Dumb Radiator" confined
to the error path; the happy path stays parser-free.

Read first, in order: the issue #60, `docs/adr/0011-error-contract-problem-details.md`
(the *why*), `docs/api/errors.md` (the catalogue of every problem `type`, its `title`,
`status`, sleep, and example `detail`/`upstream_detail`), and the relevant chunk of
`docs/api/openapi.yaml` (the wire shapes — `ProblemDetails` schema, the error `responses`).

---

## Key facts about the contract (so you don't have to chase them)

- Error body is **`application/problem+json`** (RFC 9457). Members: `type` (URL), `title`
  (short heading, stable per type), `status` (int, mirrors HTTP status), `detail` (per-occurrence
  prose), optional `instance` (`urn:gotta-go:request:<id>`), and — only for `metlink-*`
  types — `upstream_detail` (raw upstream snippet, ≤ 2 KB).
- **The firmware renders `title` as the heading and `detail` as the body.** `upstream_detail`
  is rendered **only** when the verbose flag is on. `type`/`instance`/`status` are not rendered
  (except `status` feeds the generic-fallback message — see below).
- **`X-Sleep-Seconds` stays a response header, never in the body.** The existing
  `parseSleepSeconds()` extraction is unchanged. The 300 s firmware fallback is unchanged.
  Per `errors.md`: Fatal errors (`unauthorized`, `unknown-radiator`, `metlink-auth`,
  `metlink-bad-request`) sleep `3600`; Retryable (`metlink-unavailable`, `metlink-rate-limited`,
  `internal`) sleep at the phase cadence; `not-found` sends no header (firmware 300 s fallback).
  **The firmware does not special-case any of this** — it reads whatever header is present and
  the rendering is identical for every type. The only firmware-side behaviour driven by the
  response is the binary "flush a frame, or show the error screen."
- The Worker (`src/worker/api/errors.ts`) sends the body as plain `JSON.stringify(...)` with
  **no `Content-Encoding`**. But the radiator sends `Accept-Encoding: gzip` and Cloudflare's
  edge *may* gzip non-`image/*` responses in transit, so the firmware must handle both a plain
  and a gzip-encoded error body (see Decision 2).

---

## Decisions settled in the design session (`/grill-me`)

These are final. Do not revisit without flagging.

1. **JSON parsing → ArduinoJson** (not a hand-rolled parser). Pin **7.x** (latest `7.4.3` at
   time of writing). Robust escape/encoding handling for the three string fields we lift.
   Added to the firmware toolchain via the README install step (same convention as `uzlib`),
   *not* via `sketch.yaml` (which only carries the FQBN + port here).

2. **Possibly-gzipped error body → check `Content-Encoding`, inflate if `gzip`.** Collect the
   response `Content-Encoding` header; if it contains `gzip`, run the body through the existing
   uzlib inflate before parsing; otherwise parse the drained bytes as-is. This is robust against
   whatever the edge (cloudflared quick tunnel locally, `workers.dev` in prod) does.

3. **New `CycleResult::WorkerError`.** Distinguish "reachable Worker returned a non-2xx with a
   problem doc" (→ render the error screen) from "transport failure / no response"
   (`status <= 0`: Wi-Fi/DNS/TCP/TLS dead — panel untouched). `HttpError` **narrows** to the
   transport-failure / no-response case. The transport-failure arm is **#47's** domain
   (worker-unreachable / stale indicator) and **must not change** here.

4. **Draw directly to the panel with a `NULL` framebuffer** — the hello-world idiom
   (`poc/lilygo/hello-world/hello-world.ino`): `epd_poweron(); epd_clear(); write_string(&FiraSans,
   ..., NULL); epd_poweroff();`. No PSRAM framebuffer alloc for the text screen.

5. **Word-wrap via a small `get_text_bounds`-based helper**, keeping the bundled `FiraSans`.
   There is **no** drop-in wrap library for this 16-bit parallel panel — verified against the
   Arduino registry: `LilyGo-EPD47` (a fork of `epdiy`) is the only library that drives it and
   it has no wrap; the libraries that wrap (Adafruit_GFX, LVGL) need a display driver this panel
   lacks or are heavyweight GUI frameworks. The helper is ~20 lines and uses the measurement the
   library already provides.

6. **`upstream_detail` display capped at ~512 chars**, panel clips any overflow. Verbose is a
   debugging aid; the first lines (the Metlink message) are what matter, and the full body is in
   the Worker logs anyway.

7. **Verbose flag named `RADIATOR_VERBOSE`** (namespaced like `RADIATOR_TOKEN`/`RADIATOR_SLUG`),
   **`#ifndef`-guarded default `0`** in `radiator.ino` so an existing `settings.h` without the
   define still compiles with verbose off. Documented + present in `settings.example.h` and
   `settings.h.prod`.

8. **Non-2xx with empty/unparseable body → generic fallback screen** using the HTTP status:
   heading `"Unexpected error"`, detail `"The display service returned an error (HTTP <status>)."`.
   Never a blank or held panel — visibility is the whole point of #56.

9. **Factor `drainBody()` and `inflateGzip()` into shared helpers** used by both the BMP happy
   path and the new error path (deeper modules, no duplicated TLS-drain/uzlib code). This is the
   *minimum* refactor; broader restructuring for maintainability is explicitly sanctioned — see
   *Refactoring latitude* below. Refactors that touch the working happy path are guarded by
   `arduino-cli compile` and an on-panel happy-path re-verify before moving on.

10. **The renderer takes neutral content, not an HTTP object**, so #47 can reuse it for the
    worker-unreachable case by passing locally-sourced strings. Signature:
    `renderErrorScreen(const char* title, const char* detail, const char* upstreamOrNull)`.

---

## Target structure in `radiator.ino`

New/changed pieces (names are guidance; match surrounding style):

```c
// ---- near the top, after the existing #includes ----
#include <ArduinoJson.h>
#include "firasans.h"   // bundled FiraSans GFXfont (see poc/lilygo/hello-world)

// Verbose: gate rendering of upstream_detail. Default off; override in settings.h.
#ifndef RADIATOR_VERBOSE
#define RADIATOR_VERBOSE 0
#endif

// Problem-document display caps. Titles/detail are short Worker-authored strings;
// upstream_detail is verbose-only and capped — the panel clips any overflow.
static const size_t PROBLEM_TITLE_CAP    = 64;
static const size_t PROBLEM_DETAIL_CAP   = 256;
static const size_t PROBLEM_UPSTREAM_CAP = 512;

// Error-screen layout (FiraSans advance_y = 50 px; panel is 960x540).
static const int32_t ERR_MARGIN_X   = 40;
static const int32_t ERR_MARGIN_TOP = 70;
static const int32_t ERR_LINE_GAP   = 16;   // extra px between title and body
static const int32_t ERR_WRAP_MAX_PX = EPD_WIDTH - 2 * ERR_MARGIN_X;  // 880

struct ProblemDoc {
    int  httpStatus;
    char title[PROBLEM_TITLE_CAP];
    char detail[PROBLEM_DETAIL_CAP];
    char upstream[PROBLEM_UPSTREAM_CAP];
    bool hasUpstream;
};
```

```c
// ---- CycleResult enum: add one value ----
enum class CycleResult {
    Ok,
    HttpError,      // transport failure / no response. panel untouched. (#47's arm)
    WorkerError,    // reachable Worker returned a non-2xx problem doc. error screen rendered.
    BodyTooLarge,
    InflateFailed,
    BmpInvalid,
};
```

```c
// ---- shared helper, factored out of fetchAndInflate (Commit B) ----
// Drain the response body into buf (capacity cap). Handles the HTTP/1.0
// connection-close path the cloudflared tunnel forces. Returns bytes read;
// sets *truncated when the body filled the buffer.
static size_t drainBody(HTTPClient &https, uint8_t *buf, size_t cap, bool *truncated);

// Inflate a gzip stream src[0..srcLen) into dst[0..dstCap). Returns bytes
// produced, or -1 on any uzlib error. Shared by the BMP path and the error path.
static long inflateGzip(const uint8_t *src, size_t srcLen, uint8_t *dst, size_t dstCap);
```

```c
// ---- error path (Commit C) ----
// Parse a problem+json body into doc (title/detail/upstream_detail). On any parse
// failure, leaves the string fields empty so the caller falls back to the generic
// screen. Uses ArduinoJson (JsonDocument doc; deserializeJson(...)).
static void parseProblem(const char *json, size_t len, ProblemDoc *doc);

// ---- renderer (Commit D) ----
// Wrap `in` to maxWidthPx using get_text_bounds, writing the result (with '\n'
// inserted) into out. Honours any '\n' already present in `in`.
static void wrapText(const GFXfont *font, const char *in, char *out, size_t outCap, int32_t maxWidthPx);

// Neutral content in, panel out. #47 reuses this with locally-sourced strings.
static void renderErrorScreen(const char *title, const char *detail, const char *upstreamOrNull);
```

### Flow changes in `fetchAndInflate()`

- Add `ProblemDoc *outProblem` parameter (populate on `WorkerError`).
- Add `"Content-Encoding"` to the `collectHeaders()` kept list.
- Replace the current non-2xx early return:
  ```c
  if (status < 200 || status >= 300) {
      https.end();
      return CycleResult::HttpError;   // OLD
  }
  ```
  with: drain the body via `drainBody()` into `compressedBuf`; if the response
  `Content-Encoding` contains `gzip`, `inflateGzip()` it into `inflatedBuf` and parse that,
  else parse `compressedBuf` directly; set `outProblem->httpStatus = status`; `parseProblem(...)`;
  `https.end()`; `return CycleResult::WorkerError;`.
  (The `status <= 0` transport-failure branch stays above and still returns `HttpError`.)
- Refactor the happy-path drain (current `while ((millis() - readStart) < 10000)` block) to call
  `drainBody()`; refactor the happy-path uzlib block to call `inflateGzip()`.

### Flow changes in `setup()`

After `fetchAndInflate(...)` returns:
```c
if (outcome == CycleResult::Ok) {
    if (!flushToPanel(inflatedBuf, inflatedBytes)) outcome = CycleResult::BmpInvalid;
} else if (outcome == CycleResult::WorkerError) {
    const char *up = (RADIATOR_VERBOSE && problem.hasUpstream) ? problem.upstream : nullptr;
    const char *title  = problem.title[0]  ? problem.title  : "Unexpected error";
    char detailBuf[PROBLEM_DETAIL_CAP];
    const char *detail = problem.detail[0] ? problem.detail
                       : (snprintf(detailBuf, sizeof(detailBuf),
                            "The display service returned an error (HTTP %d).",
                            problem.httpStatus), detailBuf);
    renderErrorScreen(title, detail, up);
}
```
`WiFi.disconnect(true)` can happen before rendering (rendering is offline). `sleepFor(outcome,
sleep, ...)` is unchanged except for the new `WorkerError` case in its `outcomeStr` switch
(`"worker-error"`).

---

## Logging (firmware is hard to debug — log every decision point)

Add `Serial.printf`/`println` at each branch so a serial capture alone explains the flow.
At minimum:

- `fetchAndInflate`, on non-2xx: `Serial.printf("http-error: reachable worker status=%d — draining problem body\n", status);`
- after drain: `Serial.printf("problem: body %u bytes, content-encoding=%s\n", (unsigned)total, ceHdr.c_str());`
- gzip branch: `Serial.printf("problem: inflating gzip body → %ld bytes\n", produced);` (and an
  error line if `inflateGzip` returns < 0 — then parse falls back to generic).
- after `parseProblem`: `Serial.printf("problem: parsed title='%s' detail_len=%u upstream=%s\n",
  doc->title, (unsigned)strlen(doc->detail), doc->hasUpstream ? "yes" : "no");` and, on parse
  failure, `Serial.println("problem: parse failed — generic fallback");`
- `renderErrorScreen` entry: `Serial.printf("error-screen: render title='%s' verbose=%d upstream=%s\n",
  title, RADIATOR_VERBOSE, upstreamOrNull ? "shown" : "hidden");`
- `renderErrorScreen` exit: `Serial.println("error-screen: latched");`
- `sleepFor` already logs the outcome + sleep; ensure `worker-error` prints there too.

Keep the existing happy-path logs intact through the Commit B refactor (drain byte count,
inflate ms/bytes, BMP geometry, "panel: frame latched").

---

## Commit points (each is a clean, compiling rollback boundary)

Every commit must `arduino-cli compile .` clean before it is made. Commit messages end with the
`Co-Authored-By` trailer per repo convention. Branch first: `git switch -c
feat/60-firmware-problem-json-error-screen`.

- **Commit A — scaffolding (no behaviour change).** Add `RADIATOR_VERBOSE` (`#ifndef` guard in
  `radiator.ino`; documented `=0` in `settings.example.h`, `settings.h.prod`, and the local
  `settings.h`), the `#include`s, the constants, the `ProblemDoc` struct, and
  `CycleResult::WorkerError` + its `sleepFor` switch case (value unused so far). README: add the
  `arduino-cli lib install "ArduinoJson@7.4.3"` step and list it in the verify-libs grep.
  Compile-check. *Rollback target: a tree that still behaves exactly like `main`.*

- **Commit B — factor `drainBody()` + `inflateGzip()` (no behaviour change).** Extract both from
  the happy path; the BMP path now calls them. Compile-check.
  **👤 HUMAN STEP:** flash and confirm the happy path still renders a normal frame on-panel and
  the serial log is unchanged (drain bytes, inflate ms, "panel: frame latched"). This isolates
  the only change that touches proven code, so a regression here is one `git revert` away.

- **Commit C — error-path plumbing (no rendering yet).** `fetchAndInflate` reads the non-2xx
  body, handles `Content-Encoding: gzip`, runs `parseProblem`, returns `WorkerError`. `setup()`
  logs the parsed problem but does **not** render yet (panel untouched, as before). Compile-check.
  **👤 HUMAN STEP:** force a `401` (see *Forcing errors* below) and confirm the serial log shows
  the drained/parsed `title`/`detail` and `X-Sleep-Seconds=3600`. Proves parse + transport before
  any pixels.

- **Commit D — renderer + wiring.** `wrapText` + `renderErrorScreen`; `setup()` calls it on
  `WorkerError`. Compile-check.
  **👤 HUMAN STEP:** on-panel verify a Fatal and a Retryable error (see *Verification*), plus a
  verbose on/off pass.

- **Commit E — docs.** Update `radiator.ino`'s top-of-file comment (the "non-2xx … never touch
  the panel" paragraph now points to ADR-0011 and describes the error screen). Update
  `README.md`: the ADR-0003 response-handling table gets a `WorkerError` row; add a short
  "Error screen" subsection; note `RADIATOR_VERBOSE`. Flip this plan's Status to ✅. Compile-check.

---

## Refactoring latitude

Extensive refactoring to improve maintainability is **explicitly sanctioned** for this slice —
`radiator.ino` is a single ~464-line file and adding JSON parsing + a text renderer is a natural
moment to improve its structure. You are not limited to the two helpers in Decision 9. Reasonable
moves include:

- **Splitting the sketch into multiple translation units.** Arduino compiles every `.ino` in the
  sketch folder together, and you may add `.h`/`.cpp` files alongside (or under `src/`, as the
  vendored `src/uzlib/` already does). Candidate seams: `net` (Wi-Fi + fetch/drain),
  `frame` (inflate + BMP decode + flush), `problem` (parse + error-screen render), `sleep`
  (header parse + `sleepFor`). Keep `radiator.ino` as the thin wake-cycle orchestrator.
- **Tightening the `CycleResult` → behaviour dispatch** so the ADR-0003 response-handling table
  maps cleanly to code (it is partly narrative in the README today).
- **Naming/structuring the new renderer as a reusable module** (it must be reusable by #47
  regardless — Decision 10 — so giving it a clean home is aligned).

**Guardrails:** every commit still compiles (`arduino-cli compile .`); any refactor that touches
the proven happy path keeps its own commit + on-panel re-verify (as Commit B already mandates);
do not expand scope into #47's worker-unreachable arm or into worker code; honour the "keep files
pristine" convention (no stray/leftover files, no half-moved code). If a larger restructure is
worthwhile, add it as its own commit between B and C (e.g. **Commit B2 — split into modules**)
rather than smuggling it into a feature commit, so rollback stays clean.

## 👤 Human-in-the-loop: flashing & device notes

The agent cannot flash or watch the physical panel. Each on-panel step below is a human action.

**Flashing (from `src/radiator/`):**
```sh
arduino-cli lib install "ArduinoJson@7.4.3"     # once, for this feature
arduino-cli compile .
arduino-cli upload -p /dev/ttyACM0 .
tio -b 115200 /dev/ttyACM0                       # reconnects across deep-sleep USB drops
```

**👤 If upload fails with `No serial data received`:** park the board in ROM-download mode —
hold **BOOT**, tap **RST**, release **BOOT**, then re-run `arduino-cli upload`. (Same dance as
PoC #31; documented in `poc/lilygo/hello-world/README.md`.)

**👤 USB CDC drops across deep sleep** — `/dev/ttyACM0` de-enumerates on sleep and re-enumerates
on wake. Use `tio` (auto-reconnects) or re-run `picocom`/`arduino-cli monitor` after each wake.

### Forcing errors for verification (no worker code change needed for the Fatal case)

- **👤 Fatal — `unauthorized` (401, sleep 3600):** in `settings.h` set `RADIATOR_TOKEN` to a
  wrong value, flash. Expect heading **"Radiator not authorised"**, body text from `detail`,
  and `sleeping 3600 s` in the serial log. (Alternative Fatal: a bogus `RADIATOR_SLUG` →
  **"Radiator not recognised"** 404, also 3600.) Restore the real token/slug afterward.
- **👤 Retryable — `metlink-unavailable` (502, phase cadence):** force the Worker to fail its
  Metlink call. Easiest: point the Worker's Metlink base URL at an unreachable host (or take
  upstream offline) so the gateway returns `metlink-unavailable`. Expect heading **"Transit data
  unavailable"**, body from `detail`, sleep at the phase cadence (not 3600). This needs the
  dev Worker running (see `src/radiator/README.md` → *Reach the Worker*) and a human to toggle the
  bad upstream. `metlink-*` errors also carry `upstream_detail` — use one of them for the verbose
  check below.
- **👤 Verbose check:** build once with `#define RADIATOR_VERBOSE 1` and trigger a `metlink-*`
  error → confirm the `upstream_detail` snippet appears under the body. Rebuild with the default
  (`0`, or the define removed) → confirm it is hidden. Leave the committed default at `0`.

---

## Acceptance criteria

### From GH #60 (verbatim)

- [ ] Firmware parses `application/problem+json` on non-2xx responses
- [ ] Generic error screen renders `title` + `detail` on the panel
- [ ] `verbose`/`DEBUG` flag in `setting.h` gates rendering of `upstream_detail`; off by default
- [ ] `X-Sleep-Seconds` handling and the 300s fallback remain unchanged
- [ ] Visually verified on the e-ink panel for at least one Fatal and one Retryable error
- [ ] Generic renderer is structured so #47 can reuse it for the worker-unreachable case

### Added this session (design decisions that must hold)

- [ ] Parsing uses **ArduinoJson 7.x** (added via README install step); no hand-rolled JSON parser.
- [ ] Error path handles a **gzip-encoded** body (`Content-Encoding: gzip` → inflate) **and** a
      plain body.
- [ ] Reachable non-2xx → `CycleResult::WorkerError` (renders); transport failure (`status <= 0`)
      → `CycleResult::HttpError` with the panel **untouched** (#47's arm, unchanged).
- [ ] A non-2xx with an empty/unparseable body still renders a **generic fallback** screen
      (`"Unexpected error"` + HTTP status) — never blank, never held.
- [ ] `upstream_detail` display capped at ~512 chars; overflow clipped by the panel.
- [ ] `drainBody()` and `inflateGzip()` are shared by the happy path and the error path; the BMP
      happy path is **byte-for-byte unchanged in behaviour** (Commit B on-panel re-verify passed).
- [ ] Word-wrap uses the `get_text_bounds` helper on the bundled `FiraSans`; no new display lib.
- [ ] `renderErrorScreen(title, detail, upstreamOrNull)` takes neutral content (not an HTTP
      object), so #47 can call it with locally-sourced strings.
- [ ] Generous serial logging at each error-path decision point (see *Logging*).
- [ ] Each commit (A–E) compiles clean; B/C/D each had their stated human verification before the
      next.

---

## Out of scope

- The **worker-unreachable** arm (Wi-Fi/DNS/TCP/TLS/timeout, or N consecutive failed wakes) —
  that is **#47**. This slice only builds the shared renderer #47 will reuse; it does not modify
  #47's trigger or source the content locally.
- Per-error-type screens / icons — deferred (ADR-0011). One generic layout for every type now.
- TLS certificate pinning, OTA, Wi-Fi provisioning — unchanged, still out (see README §"What this
  firmware does NOT do").
- Any worker-side change — #59 already shipped the `problem+json` emission.

---

## Verification (must pass)

```sh
cd src/radiator
arduino-cli lib install "ArduinoJson@7.4.3"
arduino-cli lib list | grep -E "ArduinoJson|uzlib|LilyGo-EPD47"   # all three present
arduino-cli compile .                                            # expect: clean, at every commit
```
On-panel (human): happy path still renders (Commit B); a Fatal error screen (401/404); a
Retryable error screen (502); verbose on shows `upstream_detail`, default hides it.
```
```
