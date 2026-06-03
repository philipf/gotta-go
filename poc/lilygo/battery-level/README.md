# PoC — battery level (LilyGo T5-4.7 ESP32-S3)

Isolated spike answering one question: **what is the Arduino code to read the
radiator's battery level?** It reads the battery every 10 s, draws the voltage,
an approximate charge percentage, and a wall-vs-battery power verdict on the
panel, and prints both the calibrated and the legacy-demo readings to serial.

Deliberately out of scope (production feature's problem):
- sending the value to the Worker (`X-Radiator-Battery-*` header contract),
- rendering a battery indicator on returned frames,
- a proper LiPo discharge curve (the on-panel `%` is a crude linear
  3.30 V → 0 %, 4.20 V → 100 % map).

## How the hardware works

From the upstream [LilyGo-EPD47](https://github.com/Xinyuan-LilyGO/LilyGo-EPD47)
library (`src/utilities.h`, `examples/demo/demo.ino`):

- On the **ESP32-S3** board the battery sits behind a **/2 voltage divider on
  GPIO 14** (`BATT_PIN`). (The classic ESP32 board uses GPIO 36.)
- **POWER_EN must be high while sampling** — the divider is gated by the same
  rail as the panel, so call `epd_poweron()` before reading and give the ADC
  ~10 ms to settle.
- The shipped demo computes `raw/4095 × 2 × 3.3 × vref/1000` with an
  eFuse-Vref calibration that **only exists on the classic ESP32**; on the S3
  it silently falls back to `vref = 1100` (uncalibrated). This sketch instead
  uses `analogReadMilliVolts(BATT_PIN) * 2`, which the Arduino core calibrates
  from the S3's eFuse curve-fit data — and prints the legacy formula alongside
  so the drift between the two is visible on serial.

## Reading the output

- **On USB**: the pin sees the charger rail, so expect ~4.2 V+ regardless of
  actual battery state. Unplug USB to read the true cell voltage (watch via
  the panel — serial obviously dies with the cable).
- **No battery connected**: the divider floats; readings are meaningless.
- Sane on-battery range: ~4.2 V (full) down to ~3.3 V (treat as empty).

### Wall-power detection

There is no direct signal: the schematic (`schematic/T5-ePaper-S3-V2.3.pdf`
in the upstream LilyGo-EPD47 repo) routes
neither VBUS nor the HX6610S charger's `CHRG`/`STDBY` status pins to any GPIO
(they only drive the indicator LEDs). The sketch infers it from the one pin we
have: while charging, the charger drives the BAT terminal above a LiPo's
natural ceiling, so **≥ 4250 mV ⇒ wall power**. Known blind spot: a *full*
battery on a standby charger floats at ~4.2 V and reads as "battery". A
rising-voltage-since-last-sample check closes that gap, but per-radiator state
belongs on the Worker (which sees every wake), not in firmware — out of scope
here.

Example serial line:

```
battery: 3942 mV (calibrated), ~71%, power=battery | raw=2310 -> 4.09 V (legacy demo formula)
```

## Taking this into `src/radiator`

Everything the production feature needs to know, including what this PoC
*couldn't* show:

- **⚠ ADC2 vs Wi-Fi — sample before `connectWiFi()`.** GPIO 14 is an **ADC2**
  channel (ADC2_CH3; the LilyGo demo characterises `ADC_UNIT_2`), and the
  ESP32 Wi-Fi driver owns ADC2 while the radio is active — reads during a
  connection can fail or return garbage. This PoC never hits it because it has
  no Wi-Fi. In the radiator wake cycle the battery **must** be sampled after
  `epd_poweron()` but **before** Wi-Fi starts. That ordering also dodges
  radio-TX voltage sag, which would otherwise read low.
- **Hook points**: sample early in the `radiator.ino` wake orchestration;
  attach the value in `net.cpp` next to the existing `X-Radiator-Slug` /
  `X-Radiator-Token` / `X-Radiator-Hardware-Id` headers (one `addHeader` line,
  but the value must be captured before `connectWiFi()` per the point above).
- **The reading recipe** (validated by this PoC): `epd_poweron()` →
  `delay(10)` → `analogReadMilliVolts(14) * 2`. Do **not** copy the upstream
  demo's `raw/4095 × 3.3 × vref` formula — its calibration is a no-op on the
  S3 (see above).
- **Jitter**: a single sample bounces ±10–20 mV. Harmless for a coarse battery
  gauge; if it matters, average a handful of reads — they're microseconds
  each.
- **Open decisions, deliberately not made here**:
  - Header unit: raw mV (`X-Radiator-Battery-Mv`) vs firmware-computed percent
    — both values matter; leaning raw mV so the discharge curve stays
    server-side and tweakable without reflashing.
  - Where the LiPo discharge curve lives (this PoC's linear 3.30→4.20 V map is
    display-only, not a contract).
  - Wall-power/charging flag: the ≥ 4250 mV threshold plus a
    rose-since-last-wake check — the Worker sees every wake and can keep
    per-radiator state, so the trend check belongs there, not in firmware.

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
