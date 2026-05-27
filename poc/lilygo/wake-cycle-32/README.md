# GottaGo — LilyGO T5 4.7": Wi-Fi + HTTPS GET + deep sleep wake cycle

Spike **#32**. Proves the **radiator** can complete the network + power half of a **wake cycle** end-to-end on the LilyGO T5, with no **panel** involvement: connect to Wi-Fi, HTTPS GET a reachable endpoint, log the response, then `esp_deep_sleep` for a fixed duration. On wake the chip cold-boots and repeats — incrementing a counter held in RTC memory so we can confirm the sleep is real and the boot cycle is clean.

This deliberately isolates the **Wi-Fi stack, TLS, and `esp_deep_sleep`** from any display concerns. It is the second half of #4's firmware ACs; [#31](../show-bmp-31/) proved the other half (BMP → panel). Nothing here touches the EPD driver or PSRAM.

Builds on [`../hello-world`](../hello-world/) (slice #30) for the toolchain and board settings — read that README first for arduino-cli setup, the FQBN, serial-port permissions, and the ROM-download-mode upload dance. This one only covers what's different.

## Files

| File | Purpose |
| --- | --- |
| `wake-cycle-32.ino` | The sketch: connect → GET → log → deep sleep, with an RTC-backed wake counter. |
| `secrets.example.h` | Template for Wi-Fi creds + target URL. Copy to `secrets.h` (gitignored). |
| `sketch.yaml` / `mise.toml` | Toolchain config (same FQBN as hello-world). |

## Configure secrets

Credentials are **hardcoded in firmware** for this spike (no provisioning UI — that is later work), but kept out of git:

```sh
cp secrets.example.h secrets.h
$EDITOR secrets.h          # set WIFI_SSID, WIFI_PASSWORD, FRAME_URL
```

`secrets.h` is gitignored. The sketch `#include`s it, so **it will not compile until that file exists**.

`FRAME_URL` can be any reachable HTTPS endpoint. `https://example.com/` is a fine generic TLS smoke test; point it at the deployed [`poc/worker-helloworld`](../../worker-helloworld/) Worker to exercise the real frame-fetch host.

## Build, flash, watch

Same toolchain as `../hello-world` (arduino-cli + esp32 core 2.0.15). With `sketch.yaml` present you can drop the `--fqbn`/`-p`:

```sh
arduino-cli compile .
arduino-cli upload -p /dev/ttyACM0 .          # see hello-world README if "No serial data received"
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

This sketch needs no EPD library and no PSRAM (no framebuffer) — only the bundled `WiFi` / `WiFiClientSecure` / `HTTPClient` that ship with the esp32 core.

### Watching across sleep — the USB CDC drops

`USBMode=hwcdc` + `CDCOnBoot=cdc` route `Serial` over the **native USB CDC** (`/dev/ttyACM0`). During deep sleep that peripheral powers down: the USB device disappears from the host and `/dev/ttyACM0` **de-enumerates, then re-enumerates on wake**. Consequences:

- `arduino-cli monitor` does **not** auto-reconnect — it dies when the port vanishes, so you see one cycle, then nothing. Use a monitor that reconnects to watch all three: `tio -m INLCRNL /dev/ttyACM0` (reconnects automatically), or `picocom -b 115200 /dev/ttyACM0` and re-run it after each wake.
- The first log lines after wake fire **before** the host re-attaches the CDC; the sketch's `delay(1000)` after `Serial.begin` covers most of it, but if a `===` banner looks clipped that's the re-enumeration race, not a crash.
- `Serial.flush()` runs right before sleep so the final "sleeping N s" line drains before the peripheral powers down.

## Expected serial output

Three consecutive cycles, 30 s of deep sleep between each. Note the **wake counter increments** and the **wake reason** flips from cold boot to timer after the first sleep — that is the proof the deep sleep is real and survives:

```
=== GottaGo wake cycle #1 (#32) — wake reason: power-on / hard reset (cold boot) ===
Wi-Fi: connecting to "your-ssid"
Wi-Fi: connected in 1843 ms — IP 192.168.1.42, RSSI -57 dBm
HTTPS: GET https://example.com/
HTTPS: status 200, content-length 1256 (412 ms)
HTTPS: first 32 bytes: 3C 21 64 6F 63 74 79 70 65 20 68 74 6D 6C 3E ...  |<!doctype html> ...|
Cycle: awake for 2487 ms (wake-to-sleep) — sleeping 30 s
                                          ⟵ deep sleep (USB drops) ⟶
=== GottaGo wake cycle #2 (#32) — wake reason: timer (deep-sleep wake) ===
Wi-Fi: connected in 1102 ms — IP 192.168.1.42, RSSI -58 dBm
HTTPS: status 200, content-length 1256 (388 ms)
...
Cycle: awake for 1701 ms (wake-to-sleep) — sleeping 30 s
=== GottaGo wake cycle #3 (#32) — wake reason: timer (deep-sleep wake) ===
...
```

**Wake-to-sleep duration** is the line that matters for battery budgeting. `millis()` resets to ~0 on each cold boot out of deep sleep, so the value logged just before sleeping is the full active window (radio on, TLS handshake, GET). A first-cycle figure of ~2–3 s, dropping on subsequent cycles as the Wi-Fi association warms, is the baseline #4 wants for the battery budget.

## How the wake counter survives sleep

`RTC_DATA_ATTR uint32_t wakeCount` lives in **RTC slow memory**, which stays powered through deep sleep. A timer wake preserves it; only a true power-on or hard RST clears it to zero. That zero-vs-nonzero split is also what `esp_sleep_get_wakeup_cause()` reports as `UNDEFINED` (cold boot) vs `TIMER` (wake) — the two agree, which is the cross-check that the cycle is clean rather than the board silently rebooting.

(NVS would also survive, but it writes to flash and wears it; RTC memory is the right tool for an ephemeral per-cycle counter. The real radiator keeps nothing across cycles anyway — it is stateless by design.)

## Acceptance criteria → where they're met

| AC | Where |
| --- | --- |
| Connect to hardcoded Wi-Fi SSID/password | `connectWiFi()`, creds from `secrets.h`. |
| HTTPS GET; log status, content length, first ~32 bytes | `httpsGet()` — status + `getSize()` + 32-byte hex/ASCII dump. |
| Deep sleep for a fixed duration, wake cleanly | `sleepNow()` → `esp_deep_sleep_start()`; cold-boots into `setup()`. |
| ≥3 cycles, counter increments & survives | `RTC_DATA_ATTR wakeCount`; see serial output above. |
| Wake-to-sleep duration logged for battery budgeting | `Cycle: awake for N ms` line. |

## What this does NOT prove

- **TLS cert validation.** The spike calls `client.setInsecure()` — it skips server-cert checks to keep the focus on connectivity. A production radiator pins or bundles the CA for the Worker's host.
- **Wi-Fi provisioning.** Credentials are hardcoded in `secrets.h`; no captive portal / UI.
- **Anything on the panel.** No EPD driver, no frame flush — that's [#31](../show-bmp-31/). Wiring the fetched bytes onto the screen (the full wake cycle) is a later slice.
- **Honouring the Worker's sleep duration.** `SLEEP_SECONDS` is a fixed 30 s constant here; reading `X-Sleep-Seconds` off the response and sleeping for that is later work.
- **Real battery draw in µA.** We log active *wall time*, not current. Translating that to mAh per cycle needs a power meter and the actual deep-sleep current.
