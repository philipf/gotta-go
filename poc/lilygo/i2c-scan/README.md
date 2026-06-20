# PoC — I2C scan (LilyGo T5-4.7 ESP32-S3)

Isolated spike answering one question, non-destructively: **is a GT911
capacitive touch controller present and powered on the board?**

The radiator firmware's deep-sleep current was cut ~7× by `epd_poweroff_all()`
(PR #122, GH #80), but a **residual ~3.5 mA** remains. A healthy T5-4.7 on the
known-good demo idles at **~330–390 µA** battery-side (LilyGo-EPD47 #144), so the
gap is real. The leading suspect is an **un-slept GT911**: the known-good demo
calls `touch.sleep()` before deep sleep; our firmware never initializes or
sleeps it, and an un-slept GT911 free-runs at several mA — matching the residual.

**But** the device under test (`office-f5`) was bought as the **non-touch**
variant, and the two SKUs share a PCB silk/layout, so the GT911 may not be
populated at all. This scan settles it with one serial line.

## Why a scan, not touch code

The scanner is **read/NAK only on I2C**. For each address it does
`Wire.beginTransmission(addr)` + `Wire.endTransmission()` and reports the ones
that ACK — it never drives the GT911 RST/INT GPIOs, never issues a device
write, never wakes touch. On the non-touch board those touch GPIOs may be
unconnected or repurposed near EPD signals; an address probe that only
ACK-checks cannot disturb them, where a full touch-driver init could. That
safety is the whole reason a scan was chosen over adding `touch.sleep()`
speculatively.

### Why it calls `epd_poweron()`

The HANDOFF originally said "do not call `epd_*`". It turns out the I2C bus —
RTC, touch, and the bus pull-ups — is fed by the **switched peripheral rail**
that `epd_poweron()` enables (the same rail the battery-level PoC notes gates
the battery divider). With the rail off, **nothing ACKs, not even the RTC**, so
the scan can't tell "GT911 absent" from "bus unpowered". The known-good demo
(`examples/demo/demo.ino`) powers the panel *before* probing the bus for exactly
this reason. So `setup()` calls `epd_init(); epd_poweron();` purely to power the
rail. That drives only the EPD config register + `STH`/`STV` (`ed047tc1.c`) — it
does **not** touch `TOUCH_INT`/RST, so the touch-GPIO safety above is preserved.

## How the hardware works

From the upstream [LilyGo-EPD47](https://github.com/Xinyuan-LilyGO/LilyGo-EPD47)
library (`src/utilities.h`, `examples/demo/demo.ino`, `examples/touch/touch.ino`):

- The T5-4.7 **ESP32-S3** shares **one I2C bus** between the **PCF8563 RTC** and
  the **GT911 touch** controller.
- The bus pins are the library's board macros, sourced from `utilities.h` rather
  than hardcoded blind: on the S3, **`BOARD_SDA = GPIO 18`, `BOARD_SCL = GPIO 17`**
  (the classic ESP32 board uses 15/14). The sketch prints which pins it used so a
  wrong-board result is obvious.

## Reading the output

The sketch scans `0x01`–`0x7F` every ~5 s and annotates each ACK:

```
GottaGo I2C-scan PoC
I2C bus pins (LilyGo-EPD47 utilities.h): SDA=GPIO18, SCL=GPIO17
Scanning 0x01-0x7F ...
  0x51 ACK -> PCF8563 RTC (expected) -> bus/pins confirmed
```

| Address ACKs | Means |
|---|---|
| `0x51` | PCF8563 RTC — expected on this board; confirms the bus/pins are correct |
| `0x5D` or `0x14` | **GT911 touch present** → it is the likely ~3 mA culprit; firmware `touch.sleep()` becomes worthwhile (do it as a raw I2C sleep write, no RST/INT toggling) |
| only `0x51`, no `0x5D`/`0x14` | **GT911 absent** → drop the touch theory; residual is elsewhere (regulator clone / USB-UART) — not firmware-fixable |
| nothing at all | Bus dead — rail didn't come up or wrong pins. The RTC at `0x51` is the canary: if it doesn't show, *no* result is trustworthy. Confirm `epd_poweron()` ran and re-derive `SDA`/`SCL` from the library |

## Build, flash, watch

Same toolchain as the other PoCs (arduino-cli + `esp32:esp32@2.0.15` +
`LilyGo-EPD47@1.0.1`) — see [`../hello-world/README.md`](../hello-world/README.md)
for first-time setup, serial-port permissions, and the ROM-download-mode
upload dance.

```sh
arduino-cli compile .
arduino-cli upload .
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

(`sketch.yaml` carries the FQBN and port, so no `--fqbn`/`-p` flags needed —
same trick the hello-world README documents.)
