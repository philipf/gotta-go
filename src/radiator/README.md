# GottaGo — `src/radiator/`

The **radiator** firmware. One sketch, one wake cycle:

```
Wi-Fi → HTTPS GET /v1/frame (gzipped BMP) → inflate → BMP decode
      → panel flush → deep sleep for X-Sleep-Seconds
```

Closes the firmware ACs of [GH #4](https://github.com/philipf/gotta-go/issues/4). Composes three earlier spikes (#30 panel hello, [#31 BMP → panel](../../poc/lilygo/show-bmp-31/), [#32 Wi-Fi + sleep](../../poc/lilygo/wake-cycle-32/)) plus the gzip inflater landed in [ADR-0008](../../docs/adr/0008-radiator-gzip-decompression.md).

This README assumes the toolchain bring-up from [ADR-0006](../../docs/adr/0006-radiator-firmware-toolchain.md) is done (arduino-cli + `esp32:esp32@2.0.15` + `LilyGo-EPD47@1.0.1`) — see [`../../poc/lilygo/hello-world/README.md`](../../poc/lilygo/hello-world/README.md) for first-time setup, the FQBN, serial-port permissions, and the ROM-download-mode upload dance.

## Files

| File | Purpose |
| --- | --- |
| `radiator.ino` | The sketch: Wi-Fi, HTTP fetch, inflate, BMP decode, panel flush, deep sleep. |
| `secrets.example.h` | Template for Wi-Fi creds + Worker URL + token + slug. Copy to `secrets.h` (gitignored). |
| `sketch.yaml` | FQBN + serial port (same shape as the PoCs). |
| `mise.toml` | Tool pin (python for esptool). |
| `.gitignore` | Excludes `secrets.h` and build artefacts. |

## Configure secrets

```sh
cp secrets.example.h secrets.h
$EDITOR secrets.h    # WIFI_SSID, WIFI_PASSWORD, FRAME_URL, RADIATOR_TOKEN, RADIATOR_SLUG
```

`secrets.h` is gitignored. The sketch `#include`s it, so it will not compile until that file exists.

If you already filled in `poc/lilygo/wake-cycle-32/secrets.h` for PoC #32, the `WIFI_SSID` and `WIFI_PASSWORD` values can be copied straight from it — it's the same network.

- `FRAME_URL` is the Worker's `/v1/frame` endpoint — for local dev, this is the cloudflared quick-tunnel URL (see *Reach the Worker* below).
- `RADIATOR_TOKEN` must equal the Worker's `RADIATOR_SHARED_TOKEN` (otherwise the Worker returns `401`).
- `RADIATOR_SLUG` must resolve to an entry in the Worker's `radiators:` config (otherwise `404`).

## Install libraries

The toolchain ADR-0006 already pulls `LilyGo-EPD47`, `SensorLib`, and `Button2`. Add the gzip inflater per ADR-0008:

```sh
arduino-cli lib install "uzlib"
```

Verify all four show up:

```sh
arduino-cli lib list | grep -E "LilyGo-EPD47|SensorLib|Button2|uzlib"
```

If `arduino-cli lib search uzlib` returns nothing, the registry name may have shifted — see the *Troubleshooting* section below.

## Build, flash, watch

Same toolchain as `poc/lilygo/wake-cycle-32` (arduino-cli + esp32 core 2.0.15 + LilyGo-EPD47 + uzlib). With `sketch.yaml` present:

```sh
arduino-cli compile .
arduino-cli upload -p /dev/ttyACM0 .          # see hello-world README if "No serial data received"
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
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

cloudflared prints a banner ending with a `*.trycloudflare.com` URL — paste `https://<that>/v1/frame` into `FRAME_URL` in `secrets.h`, then re-flash. The URL is throwaway: each `cloudflared tunnel --url` invocation gets a fresh subdomain and is dropped when the process exits.

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
Cycle #1: outcome=ok, awake 4870 ms, sleeping 300 s (X-Sleep-Seconds)
                              ⟵ deep sleep (USB drops) ⟶
=== GottaGo wake cycle #2 — wake reason: timer (deep-sleep wake) ===
...
```

The `wake-to-sleep` window (logged on the `Cycle #N:` line) is the per-cycle active duration that drives battery accounting — same baseline as PoC #32, now including BMP decode + panel flush time.

## How firmware response-handling maps to ADR-0003

ADR-0003's table tells the radiator how to react to every Worker response. The sketch encodes that table as the `CycleResult` enum + `sleepFor()` dispatch:

| ADR-0003 row | `CycleResult` | Panel touched? | Sleep source |
| --- | --- | --- | --- |
| 200 OK with valid gzipped BMP + `X-Sleep-Seconds` | `Ok` | Yes — frame flushed | `X-Sleep-Seconds` |
| 200 OK but inflate/parse fails | `InflateFailed` / `BmpInvalid` | No | `X-Sleep-Seconds` if present, else firmware fallback |
| Non-2xx with `X-Sleep-Seconds` | `HttpError` | No | `X-Sleep-Seconds` |
| Non-2xx without `X-Sleep-Seconds` | `HttpError` | No | Firmware fallback (300 s) |
| No response (Wi-Fi fail, DNS fail, TCP/TLS timeout) | `HttpError` (early exit from `setup()`) | No | Firmware fallback (300 s) |

`BodyTooLarge` is an extra row not in ADR-0003 itself: if the compressed body exceeds `MAX_COMPRESSED_BYTES` (8 KiB, ~16× the observed minimal_clock body) the radiator treats it as a parse failure. The bound surfaces a future content-profile shift early — see ADR-0008's reversal trigger about switching to streaming inflate.

## Acceptance criteria (GH #4 firmware)

| AC | Where in the sketch |
| --- | --- |
| **F1** — Sends `X-Radiator-Token`, `X-Radiator-Slug`, `Accept-Encoding: gzip` every wake; `X-Radiator-Hardware-Id` (MAC) where supported | `fetchAndInflate()` — `https.addHeader()` block |
| **F2** — Wi-Fi → headers → flush BMP to panel without artefacts → deep sleep for exactly `X-Sleep-Seconds` | Full `setup()` flow, gated on `CycleResult::Ok` |
| **F3** — One full wake cycle against the deployed Worker; panel shows correct local time within 1 minute of wake | Verified manually against a cloudflared quick tunnel, per the runbook above |

Verify F3 by:

1. Start the Worker + tunnel per *Reach the Worker*.
2. Flash + watch serial.
3. Read the wall-clock on the panel; confirm it's within 1 minute of the host clock at the moment the `panel: frame latched` line printed.

## Troubleshooting

**`uzlib.h: No such file or directory` at compile time.** The Arduino Library Manager registry has shipped uzlib under at least two names historically (`uzlib`, `Uzlib`). If `arduino-cli lib install "uzlib"` fails to find a match, search the registry: `arduino-cli lib search uzlib` and install whatever name comes back. The header include is `<uzlib.h>` (lowercase) regardless. If the registry has dropped uzlib entirely, vendor a copy under `src/radiator/uzlib/` from the upstream repo (<https://github.com/pfalcon/uzlib>) — the public API surface is stable.

**`uzlib_uncompress_init` / `uzlib_gzip_parse_header` signatures don't match.** The pfalcon/uzlib API has shifted between releases. The call site lives in `fetchAndInflate()`; align the arguments with whichever version `arduino-cli lib list | grep uzlib` reports.

**Upload fails with `No serial data received`.** Park the board in ROM download mode (hold BOOT, tap RST, release BOOT, upload). Same workaround as PoC #31 — see that README for the full sequence.

**Panel renders the frame upside-down.** The BMP decoder handles both row orders; if this happens the encoder switched. Cross-check `poc/to-bmp/index.ts` against the row-order section in `poc/lilygo/show-bmp-31/README.md`.

**Panel rendered but the clock is wrong by ≥ 1 minute.** Server-side time skew, not a firmware bug. Check `X-Server-Time` on the Worker response against the host clock; the Worker derives its frame from `new Date()` at request time.

## What this firmware does NOT do

- **TLS certificate pinning.** `client.setInsecure()` — same as PoC #32. Production radiator would pin or bundle the CA for the Worker's host.
- **Wi-Fi provisioning UI.** Credentials are hardcoded in `secrets.h`; no captive portal.
- **OTA updates.** Re-flash over USB only.
- **Telemetry beyond `X-Radiator-Hardware-Id`.** ADR-0003 reserves the `X-Radiator-*` namespace for future fields (battery, RSSI, firmware version); none of those are set yet.
- **Partial / region refreshes on the panel.** Full-frame flush only — same shape as #31. Faster refresh is a follow-up if battery accounting demands it.
