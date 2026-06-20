# Hand-off: I2C-scan spike (`poc/lilygo/i2c-scan`)

A self-contained brief for a fresh agent. Everything needed is below — you should not need the
originating chat.

## Why this exists

The radiator firmware's deep-sleep current was cut ~7× by adding `epd_poweroff_all()` (PR #122,
GH #65/#80), but a **residual ~3.5 mA** remains in deep sleep. A healthy LilyGo T5-4.7 on the
known-good demo sits **~330–390 µA** (measured battery-side, LilyGo-EPD47 issue #144), so the
~3 mA gap is real and not an inherent floor.

The leading suspect is the **GT911 capacitive touch controller** left un-slept: the known-good demo
calls `touch.sleep()` before deep sleep; our firmware never initializes or sleeps it. An un-slept
GT911 free-runs at several mA — matching the residual. **But** the device in question (`office-f5`)
was bought as the **non-touch** variant, so the GT911 may not be populated at all. The two SKUs
share a PCB silk/layout and the owner cannot inspect the back of the board, so presence is
**unresolved by eye.**

This spike answers exactly one question, non-destructively: **is a GT911 present and powered on the
board?** If yes, sleeping it is worth doing in firmware. If no, drop the GT911 theory and look at the
regulator (clone "2U=S3H" vs ME6211, T5-Epaper-Series #63) or USB-UART bridge instead.

## Scope guard

- **Do NOT touch `src/radiator/`.** No firmware changes, no `touch.sleep()` in production yet — that
  decision waits on this spike's result.
- A **separate spare board** will run this scan — NOT `office-f5`, which is mid-experiment running on
  battery until Monday night. Do not assume the scan board is the one under test.
- Build the spike; you do not need to flash it (the owner flashes the spare device).

## Deliverable

Create `poc/lilygo/i2c-scan/` following the **exact conventions of the sibling spike
`poc/lilygo/battery-level/`** (read it first — it is the template):

| File | Content |
|---|---|
| `i2c-scan.ino` | The scanner (spec below) |
| `sketch.yaml` | Copy verbatim from `battery-level/sketch.yaml` (pins the S3 FQBN + `default_port`) |
| `mise.toml` | Copy from a sibling (`[tools]` python latest — matches the others) |
| `README.md` | Short: purpose, how to build/flash, how to read the output, the interpretation table below |

Match the house style of `battery-level.ino`: top-of-file doc comment explaining intent, the
`#ifndef BOARD_HAS_PSRAM #error` guard, concise comments. Keep files pristine — nothing stray.

## `i2c-scan.ino` behavior spec

1. `setup()`: `Serial.begin(115200)`; small delay for CDC re-attach (see how `battery-level.ino`
   handles it / the radiator's `announceWake`).
2. `Wire.begin(SDA, SCL)` on the board's I2C bus pins. **Source the pins canonically — do not guess.**
   The LilyGo-EPD47 library exposes them (the touch example / `utilities.h` uses board `SDA`/`SCL`
   macros; T5-4.7 S3 shares one I2C bus between the **PCF8563 RTC** and the **GT911 touch**). Pull the
   values from the installed library headers (`~/Arduino/libraries/LilyGo-EPD47/`) rather than
   hardcoding a number blind, and print which pins were used.
3. Scan addresses `0x01`–`0x7F`: for each, `Wire.beginTransmission(addr)` + `Wire.endTransmission()`,
   report addresses that ACK (return 0).
4. Print each found address in hex, annotated against the legend below; print a "no devices found"
   line if none.
5. Loop every ~5 s so the owner can watch over serial.

**Hard safety constraint — this is the whole point of choosing a scan over adding touch code:**
the scanner must be **read/NAK only**. Do **NOT** drive the GT911 RST/INT GPIOs, do **NOT** issue
device writes, do **NOT** call `epd_*`. On the non-touch board those touch GPIOs may be unconnected or
repurposed near EPD signals; an I2C address probe that only ACK-checks cannot disturb them, which is
why it is safe where a full touch-driver init is not.

## Interpretation table (put this in the README)

| Address ACKs | Means |
|---|---|
| `0x51` | PCF8563 RTC — expected on this board; confirms the bus/pins are correct |
| `0x5D` or `0x14` | **GT911 touch present** → it is the likely ~3 mA culprit; firmware `touch.sleep()` becomes worthwhile (do it as a raw I2C sleep write, no RST/INT toggling) |
| only `0x51`, no `0x5D`/`0x14` | **GT911 absent** → drop the touch theory; residual is elsewhere (regulator clone / USB-UART) — not firmware-fixable |
| nothing at all | Wrong I2C pins — re-derive `SDA`/`SCL` from the library before trusting the result |

## Verification

- `arduino-cli compile` against the FQBN in `sketch.yaml` (same toolchain the other spikes use; see
  `battery-level/README.md` for the invocation). Confirm it builds clean.
- Hand back to the owner to flash on the spare board and read the serial output. One line tells us
  whether the GT911 exists.

## References

- LilyGo-EPD47 #144 — residual deep-sleep current; demo measured ~330–390 µA battery-side.
- Known-good demo sleep sequence: `epd_poweroff_all(); WiFi.disconnect(true); touch.sleep();
  Wire.end(); Serial.end(); esp_deep_sleep_start();`
- GH #80 (battery investigation, canonical home) / #65 (closed dup, the rail fix) / PR #122.
- Template spike: `poc/lilygo/battery-level/`.
