# GottaGo — `src/radiator/`

The **radiator** firmware. One sketch, one wake cycle:

```
Wi-Fi → HTTPS GET /v1/frame (If-None-Match: stored ETag)
      → 200: inflate → BMP decode → panel flush → store ETag
      → 304: unchanged-frame skip — panel untouched (ADR-0013)
      → deep sleep for X-Sleep-Seconds
```

Closes the firmware ACs of [GH #4](https://github.com/philipf/gotta-go/issues/4). Composes three earlier spikes (#30 panel hello, [#31 BMP → panel](../../poc/lilygo/show-bmp-31/), [#32 Wi-Fi + sleep](../../poc/lilygo/wake-cycle-32/)) plus the gzip inflater landed in [ADR-0008](../../docs/adr/0008-radiator-gzip-decompression.md).

This README assumes the toolchain bring-up from [ADR-0006](../../docs/adr/0006-radiator-firmware-toolchain.md) is done (arduino-cli + `esp32:esp32@2.0.15` + `LilyGo-EPD47@1.0.1`) — see [`../../poc/lilygo/hello-world/README.md`](../../poc/lilygo/hello-world/README.md) for first-time setup, the FQBN, serial-port permissions, and the ROM-download-mode upload dance.

## Files

| File                | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `radiator.ino`      | Wake-cycle orchestrator: allocates scratch, drives one request, maps the response onto the ADR-0003/0011/0013 table, keeps the RTC-backed stored ETag truthful, deep-sleeps. |
| `net.{h,cpp}`       | Wi-Fi + HTTP transport + body I/O: `connectWiFi`, `fetchFrame` → `HttpResponse` (sends `If-None-Match`, captures `ETag`), body drain, gzip `inflateGzip`. The pure `classifyResponse()` in the header is host-tested; the rest is device-only. |
| `frame.{h,cpp}`     | 1bpp BMP decode + panel flush (`flushToPanel`). `decodeBmpToFramebuffer` validation is host-tested. |
| `problem.{h,cpp}`   | Error-screen module (ADR-0011): problem+json parse, fallback resolution, on-panel render. Neutral `renderErrorScreen()` reusable by #47. |
| `etag.h`            | Stored-ETag policy ([ADR-0013](../../docs/adr/0013-conditional-frame-requests.md) / GH #74): `panelStateAfter()` + `chooseEtagAction()` encode the store/keep/clear rules; pure, host-tested. |
| `sleep.h`           | `SleepHeader` + pure `parseSleepSecondsValue()` (ADR-0003); host-tested. Seed of the #5 sleep module. |
| `battery.{h,cpp}`   | Battery-voltage sample (GH #79): `sampleBatteryMv()` — pre-Wi-Fi ADC2 power pulse, avg of 8 reads → `X-Radiator-Battery-Mv`. Device-only. |
| `test/`             | Host-native unit tests (CMake + doctest) for the pure logic — see [`test/README.md`](test/README.md) and [ADR-0012](../../docs/adr/0012-radiator-host-native-tests.md). |
| `settings.example.h` | Template for Wi-Fi creds + Worker URL + token + slug. Copy to `settings.<variant>.h` (gitignored). |
| `settings.<variant>.h` | Per-deployment settings (e.g. `settings.dev.h`, `settings.f5.h`). `./flash.sh <variant>` copies the chosen one onto the generated `settings.h`. |
| `flash.sh`          | `./flash.sh <variant>` — apply the settings variant, compile, upload, then watch the serial monitor. Variants are discovered from the `settings.<variant>.h` files present; no arg lists them. |
| `sketch.yaml`       | FQBN + serial port (same shape as the PoCs).                                            |
| `mise.toml`         | Tool pin (python for esptool).                                                          |
| `gen_compile_commands.py` | Regenerates `compile_commands.json` with real source paths so `clangd` can navigate the firmware in an editor. See _Editor / LSP_. |
| `.gitignore`        | Excludes `settings.h`, `settings.<variant>.h` (the tracked `settings.example.h` excepted), `compile_commands.json`, and build artefacts. |

## Configure settings

Settings are per-deployment. Copy the template once per variant and fill in real values (the `.h` extension comes last so editors apply C/C++ syntax highlighting):

```sh
cp settings.example.h settings.dev.h            # local Worker (cloudflared quick tunnel)
cp settings.example.h settings.parents-home.h   # a deployed-Worker device variant
$EDITOR settings.dev.h settings.parents-home.h  # WIFI_SSID, WIFI_PASSWORD, FRAME_URL, RADIATOR_TOKEN, RADIATOR_SLUG
```

`./flash.sh <variant>` (see _Build, flash, watch_) copies the chosen variant onto `settings.h` — the file the sketch `#include`s. Variants are discovered from the `settings.<variant>.h` files present, so a new radiator means a new settings file, never a script change. **`settings.h` is generated and throwaway; edit the variants, never `settings.h` directly.**

`settings.h` and every `settings.<variant>.h` are gitignored (only `settings.example.h` is tracked). The sketch `#include`s `settings.h`, so it will not compile until `./flash.sh <variant>` has generated it (or you `cp` a variant onto it by hand).

> Renamed from `secrets.h` in [#52](https://github.com/philipf/gotta-go/issues/52). If you have a pre-existing gitignored `secrets.h`, rename it: `git mv`-free — just `mv secrets.h settings.dev.h`.

If you already filled in `poc/lilygo/wake-cycle-32/secrets.h` for PoC #32, the `WIFI_SSID` and `WIFI_PASSWORD` values can be copied straight from it — it's the same network.

- `FRAME_URL` is the Worker's `/v1/frame` endpoint — for local dev, this is the cloudflared quick-tunnel URL (see _Reach the Worker_ below).
- `RADIATOR_TOKEN` must equal the Worker's `RADIATOR_SHARED_TOKEN` (otherwise the Worker returns `401`).
- `RADIATOR_SLUG` must resolve to an entry in the Worker's `radiators:` config (otherwise `404`).
- `RADIATOR_VERBOSE` (default `0`) gates the verbose error screen — set to `1` to render the raw `upstream_detail` snippet beneath the error body (see _Error screen_ below).

## Install libraries

The toolchain ADR-0006 already pulls `LilyGo-EPD47`, `SensorLib`, and `Button2`. Add the gzip inflater per ADR-0008 and the JSON parser the error screen uses per [ADR-0011](../../docs/adr/0011-error-contract-problem-details.md):

```sh
arduino-cli lib install "uzlib"
arduino-cli lib install "ArduinoJson@7.4.3"
```

Verify they show up:

```sh
arduino-cli lib list | grep -E "LilyGo-EPD47|SensorLib|Button2|uzlib|ArduinoJson"
```

If `arduino-cli lib search uzlib` returns nothing, the registry name may have shifted — see the _Troubleshooting_ section below. `ArduinoJson` is pinned at `7.x`; the error-path parser uses the v7 `JsonDocument` API.

## Build, flash, watch

Same toolchain as `poc/lilygo/wake-cycle-32` (arduino-cli + esp32 core 2.0.15 + LilyGo-EPD47 + uzlib). The easiest path is `flash.sh`, which selects a settings variant, compiles, walks you through the ROM-download-mode button dance, uploads, and opens the serial monitor:

```sh
./flash.sh dev      # apply settings.dev.h, compile, upload, watch
./flash.sh f5       # apply settings.f5.h,  compile, upload, watch
./flash.sh          # list the available variants
```

`flash.sh` compiles _before_ prompting for the button dance, so a bad arg or a broken build fails before you touch the board. It prints the target `FRAME_URL`, `RADIATOR_SLUG`, and `WIFI_SSID` for an eyeball check; the Wi-Fi password and token are never printed.

Or run the steps by hand (with `sketch.yaml` present, after `cp settings.dev.h settings.h`):

```sh
arduino-cli compile .
arduino-cli upload -p /dev/ttyACM0 .          # see hello-world README if "No serial data received"
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200

# or alternative monitoring that automatically reconnects
tio -b 115200 /dev/ttyACM0
```

**Watching across sleep — the USB CDC drops.** `USBMode=hwcdc` + `CDCOnBoot=cdc` route `Serial` over the native USB CDC; the peripheral powers down during deep sleep and `/dev/ttyACM0` de-enumerates / re-enumerates on wake. `arduino-cli monitor` will not auto-reconnect; use `tio -m INLCRNL /dev/ttyACM0` (reconnects automatically) or `picocom -b 115200 /dev/ttyACM0` and re-run after each wake.

## Reach the Worker

AC-F3 closes against the **deployed Worker**. The cheapest unblock — no production deploy yet (deferred to [#12](https://github.com/philipf/gotta-go/issues/12)) — is a cloudflared **quick tunnel** that fronts `wrangler dev` with a throwaway public HTTPS URL.

In one terminal, start the Worker:

```sh
cd ../worker
pnpm install         # if not already done
pnpm dlx wrangler dev --local --port 8787
```

In a second terminal, expose it:

```sh
yay -S cloudflared            # AUR; cloudflared-bin works too. Not in core/extra.
cloudflared tunnel --url http://localhost:8787
```

cloudflared prints a banner ending with a `*.trycloudflare.com` URL — paste `https://<that>/v1/frame` into `FRAME_URL` in `settings.h.dev`, then re-flash with `./flash.sh dev`. The URL is throwaway: each `cloudflared tunnel --url` invocation gets a fresh subdomain and is dropped when the process exits.

**Why a quick tunnel rather than `wrangler deploy`.** Per the Worker AC comment on #4, production deploy is intentionally deferred to #12 ("Multi-radiator rollout"). The quick tunnel exercises the same HTTPS surface as a deployed Worker without pulling deploy / DNS / KV-namespace scope into this slice.

## Expected serial output

Cold boot, one happy-path cycle, sleeping per the Worker's `X-Sleep-Seconds`:

```
=== GottaGo wake cycle #1 — wake reason: power-on / hard reset (cold boot) ===
Wi-Fi: connecting to "your-ssid"
Wi-Fi: connected in 1843 ms — IP 192.168.1.42, RSSI -57 dBm
HTTPS: GET https://abcd-ef-12.trycloudflare.com/v1/frame
HTTPS: status 200, content-length 525, sleep=300 (412 ms)
body: 525 compressed bytes received
inflate: ok 64862 bytes in 18 ms
BMP: 960x540 1bpp comp=0 offset=62 top-down
decode: ok in 24 ms
panel: frame latched
etag: stored W/"6e1064b09d4c64fe"
Cycle #1: outcome=ok, awake 4870 ms, sleeping 300 s (X-Sleep-Seconds)
                              ⟵ deep sleep (USB drops) ⟶
=== GottaGo wake cycle #2 — wake reason: timer (deep-sleep wake) ===
...
```

A wake whose content is unchanged (e.g. the `daytime_calendar` phase between midnight rollovers) takes the `304` skip instead — no inflate, no decode, no panel flash:

```
HTTPS: status 304, content-length 0, sleep=14400 (402 ms)
body: none (304 Not Modified)
frame: 304 unchanged — skipping panel flush (ADR-0013)
Cycle #7: outcome=not-modified, awake 3120 ms, sleeping 14400 s (X-Sleep-Seconds)
```

The `wake-to-sleep` window (logged on the `Cycle #N:` line) is the per-cycle active duration that drives battery accounting — same baseline as PoC #32, now including BMP decode + panel flush time.

## How firmware response-handling maps to ADR-0003 / ADR-0011 / ADR-0013

ADR-0003's table tells the radiator how to react to every Worker response; [ADR-0011](../../docs/adr/0011-error-contract-problem-details.md) refines the error path so a reachable Worker error is shown on-panel instead of held silently; [ADR-0013](../../docs/adr/0013-conditional-frame-requests.md) adds the `304` unchanged-frame skip. The sketch encodes that as the `CycleResult` enum + `sleepFor()` dispatch:

| ADR-0003 / ADR-0011 / ADR-0013 row                             | `CycleResult`                           | Panel touched?       | Sleep source                                         |
| -------------------------------------------------------------- | --------------------------------------- | -------------------- | ---------------------------------------------------- |
| 200 OK with valid gzipped BMP + `X-Sleep-Seconds`              | `Ok`                                    | Yes — frame flushed  | `X-Sleep-Seconds`                                    |
| 200 OK but inflate/parse fails                                 | `InflateFailed` / `BmpInvalid`          | No                   | `X-Sleep-Seconds` if present, else firmware fallback |
| 304 Not Modified (stored ETag matched)                         | `NotModified`                           | No — unchanged-frame skip | `X-Sleep-Seconds` if present, else firmware fallback |
| Reachable non-2xx (`problem+json`) with `X-Sleep-Seconds`      | `WorkerError`                           | Yes — error screen   | `X-Sleep-Seconds`                                    |
| Reachable non-2xx (`problem+json`) without `X-Sleep-Seconds`   | `WorkerError`                           | Yes — error screen   | Firmware fallback (300 s)                            |
| Transport failure / no response (Wi-Fi/DNS/TCP/TLS timeout)    | `HttpError` (early exit from `setup()`) | No                   | Firmware fallback (300 s)                            |

`BodyTooLarge` is an extra row not in ADR-0003 itself: if the compressed body exceeds `MAX_COMPRESSED_BYTES` (8 KiB, ~16× the observed minimal_clock body) the radiator treats it as a parse failure. The bound surfaces a future content-profile shift early — see ADR-0008's reversal trigger about switching to streaming inflate.

### Error screen

On a **reachable** non-2xx the Worker returns an `application/problem+json` body (RFC 9457; see [`docs/api/errors.md`](../../docs/api/errors.md)). `net::fetchFrame()` drains it; the orchestrator's `renderWorkerError()` inflates it if the edge gzipped it in transit (`Content-Encoding: gzip`), parses it with ArduinoJson (`problem::parseProblem`), and `renderErrorScreen()` then draws the problem's `title` as the heading and `detail` as the body to the panel — so a wrong `RADIATOR_TOKEN` (`401` "Radiator not authorised") or a Metlink outage (`502` "Transit data unavailable") is visible rather than masquerading as a quiet frame. An empty or unparseable body still renders a generic `"Unexpected error"` screen with the HTTP status — never a blank or stale panel.

Set `RADIATOR_VERBOSE 1` in `settings.h` to also render the raw `upstream_detail` snippet (carried on `metlink-*` errors) beneath the body — a debugging aid, off by default. The renderer takes neutral strings, not an HTTP object, so [#47](https://github.com/philipf/gotta-go/issues/47) can reuse it for the worker-unreachable case. A **transport** failure (Wi-Fi/DNS/TCP/TLS dead, no response) is *not* a Worker error: it stays `HttpError` and leaves the panel untouched — that stale-frame / unreachable indicator is #47's domain.

### Conditional requests — the stored ETag (ADR-0013 / GH #74)

The radiator keeps the last `200`'s `ETag` in RTC slow memory (`storedEtag` — survives deep sleep, zeroed on cold boot) and echoes it verbatim as `If-None-Match` on every wake. A matching validator gets a `304 Not Modified`: no body, no panel flush — the e-ink keeps its frame with no visible flash — and `X-Sleep-Seconds` is honoured as on any response. The bookkeeping rules live in [`etag.h`](etag.h) and are host-tested:

- **Store** a new ETag only after a successfully flushed `200`. A `200` whose body fails inflate/decode keeps the old value (the panel still shows the old frame), and a `200` without an `ETag` header clears it.
- **Keep** it whenever the panel is untouched — `304`, transport failure, oversized/unparseable body.
- **Clear** it whenever the panel shows anything other than a frame — the ADR-0011 error screen and the #66 Wi-Fi error screen both clear, so a later `304` can never strand an error screen on the panel. The next wake then sends no `If-None-Match` and takes the full `200` redraw.

One wire quirk from #73: the Workers runtime appends an incidental `Content-Encoding: gzip` to the bodiless `304` whenever the request advertised `Accept-Encoding: gzip`. The firmware branches on the status *before* any body handling (`classifyResponse()` in [`net.h`](net.h)), so those zero bytes never reach the inflate path — guarded by a host-native test.

## Acceptance criteria (GH #4 firmware)

| AC                                                                                                                                       | Where in the sketch                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **F1** — Sends `X-Radiator-Token`, `X-Radiator-Slug`, `Accept-Encoding: gzip` every wake; `X-Radiator-Hardware-Id` (MAC) where supported | `net::fetchFrame()` — `https.addHeader()` block                             |
| **F2** — Wi-Fi → headers → flush BMP to panel without artefacts → deep sleep for exactly `X-Sleep-Seconds`                               | Full `setup()` flow, gated on `CycleResult::Ok`                             |
| **F3** — One full wake cycle against the deployed Worker; panel shows correct local time within 1 minute of wake                         | Verified manually against a cloudflared quick tunnel, per the runbook above |

Verify F3 by:

1. Start the Worker + tunnel per _Reach the Worker_.
2. Flash + watch serial.
3. Read the wall-clock on the panel; confirm it's within 1 minute of the host clock at the moment the `panel: frame latched` line printed.

## Editor / LSP (clangd)

Cross-file navigation (Go to Definition from `radiator.ino` into `net.cpp`, `sleep.cpp`, …) is handled by **clangd**, not `arduino-language-server` — the latter can't resolve definitions across a sketch's sibling `.cpp` files. clangd needs a `compile_commands.json` with **real** source paths; `arduino-cli` only emits one using build-cache paths, so `gen_compile_commands.py` translates it back:

```sh
arduino-cli compile             # populate the build cache (or ./flash.sh dev)
python3 gen_compile_commands.py # write compile_commands.json with real paths
```

Run `gen_compile_commands.py` **once after a build-configuration change** — adding a library, changing board options in `sketch.yaml`, or bumping the ESP32 core. Editing or adding source files does **not** need a re-run: clangd applies the cached flags to every file in the sketch. `compile_commands.json` is a derived artifact and is gitignored.

The matching Neovim config lives outside this repo (`~/.config/nvim/...`); it routes a `.ino` to clangd **only when a `compile_commands.json` is present**, so simple `.ino`-only sketches elsewhere keep using `arduino-language-server`. The full investigation and the exact `lspconfig` snippet are in [`../../docs/arduino-lsp-nvim.md`](../../docs/arduino-lsp-nvim.md).

## Troubleshooting

**`uzlib.h: No such file or directory` at compile time.** The Arduino Library Manager registry has shipped uzlib under at least two names historically (`uzlib`, `Uzlib`). If `arduino-cli lib install "uzlib"` fails to find a match, search the registry: `arduino-cli lib search uzlib` and install whatever name comes back. The header include is `<uzlib.h>` (lowercase) regardless. If the registry has dropped uzlib entirely, vendor a copy under `src/radiator/uzlib/` from the upstream repo (<https://github.com/pfalcon/uzlib>) — the public API surface is stable.

**`uzlib_uncompress_init` / `uzlib_gzip_parse_header` signatures don't match.** The pfalcon/uzlib API has shifted between releases. The call site lives in `net::inflateGzip()`; align the arguments with whichever version `arduino-cli lib list | grep uzlib` reports.

**Upload fails with `No serial data received`.** Park the board in ROM download mode (hold BOOT, tap RST, release BOOT, upload). Same workaround as PoC #31 — see that README for the full sequence.

**Panel renders the frame upside-down.** The BMP decoder handles both row orders; if this happens the encoder switched. Cross-check `poc/to-bmp/index.ts` against the row-order section in `poc/lilygo/show-bmp-31/README.md`.

**Panel rendered but the clock is wrong by ≥ 1 minute.** Server-side time skew, not a firmware bug. Check `X-Server-Time` on the Worker response against the host clock; the Worker derives its frame from `new Date()` at request time.

## What this firmware does NOT do

- **TLS certificate pinning.** `client.setInsecure()` — same as PoC #32. Production radiator would pin or bundle the CA for the Worker's host.
- **Wi-Fi provisioning UI.** Credentials are hardcoded in `settings.h`; no captive portal.
- **OTA updates.** Re-flash over USB only.
- **Telemetry beyond `X-Radiator-Hardware-Id` and `X-Radiator-Battery-Mv`.** ADR-0003 reserves the `X-Radiator-*` namespace for further fields (RSSI, firmware version); none of those are set yet. Battery telemetry (GH #79) sends raw mV only — interpretation (discharge curve, wall-power detection) is the Worker's job.
- **Partial / region refreshes on the panel.** Full-frame flush only — same shape as #31. Faster refresh is a follow-up if battery accounting demands it.
