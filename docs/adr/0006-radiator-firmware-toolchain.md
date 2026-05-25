# ADR-0006: Radiator firmware toolchain — arduino-cli + ESP32 Arduino core 2.0.15

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — **radiator**, **panel**.
- **Related contracts:** [ADR-0005](0005-worker-source-architecture.md) (sibling `src/<project>/` toolchain isolation).
- **Resolves:** GH #29 (toolchain bring-up). Unblocks GH #30 (panel hello world), #31 (1-bit BMP flush), #32 (Wi-Fi + deep sleep cycle).

## Context

GH #29 asked for first contact with the **LilyGO T5 4.7"** board: stand up an edit → build → flash → observe loop and prove the board boots and can print over USB serial. The issue called out three candidate toolchains — **PlatformIO**, **ESP-IDF**, and **Arduino-ESP32** — and required this ADR to record the choice and its quirks before any further firmware slice (#30, #31, #32) builds on it.

The panel driver is non-trivial: the LilyGO T5 4.7" needs the vendor's `LilyGo-EPD47` library (a thin wrapper over `epdiy` with the board pinout and FiraSans bundled). That library is the practical centre of gravity for any toolchain choice — whichever toolchain consumes `LilyGo-EPD47` cleanest wins the spike.

ADR-0005 already committed the repo shape: firmware lives under `src/radiator/` as a sibling to `src/worker/`, each owning its own toolchain. This ADR fills in what that toolchain is.

## Decision

**Arduino-ESP32, driven by `arduino-cli`, pinned to ESP32 core `2.0.15`, with `LilyGo-EPD47@1.0.1` installed from the Arduino Library Manager registry.**

### Why this combination

1. **`LilyGo-EPD47` on the registry is built for the ESP32 Arduino 2.x core.** Its `rmt_pulse.c` uses the legacy ESP-IDF v4 RMT driver API (`rmt_config_t`, `rmt_driver_install`). On core 3.x — which ships ESP-IDF v5 — the source references new-API types (`rmt_channel_handle_t`, `rmt_tx_channel_config_t`, `rmt_new_tx_channel`) without the headers that define them, and the compile fails with `unknown type name 'rmt_channel_handle_t'`. Until the upstream library is updated for IDF v5, **pin to core 2.0.15**. Reverify on each library release.
2. **Install from the registry, not from `--git-url`.** The registry version is the library author's tested release; the git default branch tracks in-progress changes that have produced the IDF v5 type mismatches above. `arduino-cli lib install "LilyGo-EPD47"` is the canonical path; it also resolves the `SensorLib` and `Button2` dependencies in one step, matching the IDE's "Install all" prompt.
3. **`arduino-cli` over the Arduino IDE.** Headless, scriptable, version-pinnable, fits the CI rhythm the rest of the repo uses. The IDE remains a valid second path for hardware bring-up sessions (clicking through Tools menus is friendlier than memorising FQBN strings), and the firmware-side README documents both — but the canonical path is the CLI.
4. **Arduino-ESP32 over PlatformIO or raw ESP-IDF.** All three can drive `LilyGo-EPD47`, but Arduino-ESP32 had the lowest setup cost for first-flash, the LilyGO vendor docs target it, and the registry install does dependency resolution. PlatformIO adds its own dependency manager on top with no near-term benefit; raw ESP-IDF requires rewriting `LilyGo-EPD47`'s Arduino glue. Revisit when the firmware grows past sketch ergonomics — see *Reversal triggers* below.

### FQBN (canonical for this board)

```
esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,FlashMode=qio,PSRAM=opi,USBMode=hwcdc,CDCOnBoot=cdc
```

Each option key is load-bearing — see *Quirks discovered during bring-up* for why.

### Toolchain inventory

| Component | Version pinned at bring-up | Lives in |
|---|---|---|
| `arduino-cli` | system package (Arch `arduino-cli`) | host PATH |
| ESP32 Arduino core | `esp32:esp32@2.0.15` | `~/.arduino15/packages/esp32/` |
| `LilyGo-EPD47` | `1.0.1` (registry) | `~/Arduino/libraries/LilyGo-EPD47/` |
| `SensorLib` | `0.4.1` (registry, transitive) | `~/Arduino/libraries/SensorLib/` |
| `Button2` | `2.6.0` (registry, transitive) | `~/Arduino/libraries/Button2/` |
| `pyserial` | `3.5` (whichever Python `#!/usr/bin/env python` resolves to) | site-packages |

The board manager URL needed for the ESP32 core: `https://espressif.github.io/arduino-esp32/package_esp32_index.json` — set once via `arduino-cli config add board_manager.additional_urls`.

### Quirks discovered during bring-up

1. **ESP32 core 3.x silently breaks `LilyGo-EPD47`.** Symptom: `unknown type name 'rmt_channel_handle_t'` cascade across `src/rmt_pulse.c`. Root cause: legacy vs new RMT driver API. Fix: pin core to 2.0.15.
2. **Library installed via `--git-url` ≠ registry version.** The git default branch contains the IDF v5 attempt above. `arduino-cli lib install "LilyGo-EPD47"` (hyphenated registry name) installs `1.0.1` and resolves dependencies. Do not use `--git-url` for this library until upstream releases an IDF-v5-clean version.
3. **`CDCOnBoot=cdc` is required for serial output.** Default is `CDCOnBoot=default` (disabled), which routes `Serial` to the UART0 pins, not the USB CDC interface. With it disabled, panel rendering works but the host sees no bytes on `/dev/ttyACM0`. The required setting is documented at the top of `hello-world.ino`; the FQBN above encodes it.
4. **`PartitionScheme=app3M_fat9M_16MB` is required.** The default partition table assumes 4 MB flash; the T5 4.7" has 16 MB and the LilyGO docs require the 3 MB APP / 9.9 MB FATFS scheme to leave headroom for assets the vendor demos use. Omitting it compiles but the partition layout doesn't match the documented hardware capacity.
5. **`PSRAM=opi` is required.** The sketch contains `#error "Enable PSRAM: …"` if `BOARD_HAS_PSRAM` isn't defined; the OPI mode is the variant on the T5 4.7" S3 board.
6. **`esptool` uses `#!/usr/bin/env python`, not a bundled interpreter.** It needs `pyserial` in *whichever* Python `which python` resolves to. On a workstation using **mise** (or pyenv/asdf) to manage Python, the system `pacman -S python-pyserial` package is invisible because the user's PATH-active Python isn't the system one. Fix: `pip install pyserial` against the active mise Python. This is fragile in a way the rest of the toolchain isn't — see *Negative consequences*.
7. **Native USB CDC means `arduino-cli monitor` can miss the boot `println`.** The `Hard resetting via RTS pin` step at end-of-upload re-enumerates `/dev/ttyACM0`; the sketch's `Serial.println` in `setup()` fires before the host can re-attach. To capture it, open the monitor *first*, then press the physical RESET button on the board. Toggling DTR/RTS from pyserial fails with `Errno 5 Input/output error` on this USBMode — it's a hardware-CDC limitation, not a software bug.
8. **Library examples folder is the authoritative FQBN reference.** When in doubt about a board option key, the top-of-sketch comment block in any `LilyGo-EPD47/examples/*.ino` lists the IDE Tools-menu settings; map them to FQBN keys via `arduino-cli board details -b esp32:esp32:esp32s3`.

### Reversal triggers

Pick one and re-evaluate this ADR if it fires:

- **`LilyGo-EPD47` releases a version supporting the ESP32 Arduino 3.x core.** Promote the core pin and reverify the FQBN.
- **The firmware grows past a single-sketch project structure** (multiple translation units, shared modules between layouts, board-variant abstractions). At that point sketch ergonomics start hurting; revisit PlatformIO or raw ESP-IDF, which both handle multi-file projects natively.
- **CI needs to build the firmware.** arduino-cli can do this, but PlatformIO has more mature CI tooling. Cost is non-trivial — only switch if CI is actually being stood up, not speculatively.
- **A second board variant joins the radiator family.** PlatformIO's `[env:]` matrix handles multi-target builds more cleanly than juggling FQBN strings in shell scripts.

## Consequences

### Positive

- **Fast to first-flash.** `arduino-cli compile && arduino-cli upload` is the entire CLI loop; documented in `poc/lilygo/hello-world/README.md`.
- **Dependency resolution is automatic.** Registry install pulls `SensorLib` and `Button2` transitively; no copy-paste from GitHub READMEs.
- **Sibling-symmetric with the worker per ADR-0005.** Firmware will land under `src/radiator/` with its own `mise.toml` and own arduino-cli config, parallel to `src/worker/`. Neither side's toolchain leaks into the other.
- **README captures every quirk.** The PoC's `README.md` is the bring-up runbook; #30/#31/#32 inherit it without rediscovery.

### Negative / follow-ups

- **Pinned to ESP32 core 2.0.15 — a frozen branch.** No new IDF features, no new chip support, no security backports beyond what Espressif maintains on 2.x. Acceptable while the library is the constraint; revisit on every `LilyGo-EPD47` release.
- **`pyserial`-in-mise-Python is fragile.** The dependency lives outside Arduino's package management; a `mise use python@<new>` swap will lose it silently. Mitigations to consider: a `src/radiator/mise.toml` post-install hook that runs `pip install pyserial`, or a project-level `requirements.txt` next to the firmware sketch. Deferred until #30 lands; documented in the README troubleshooting section in the meantime.
- **arduino-cli isn't itself mise-managed.** It lives as a system package (`pacman -S arduino-cli` on Arch). The reproducibility story is "follow the README", not "`mise install` and go". Acceptable for a single-developer project; revisit if a second contributor or CI gets involved.
- **Sketch layout doesn't scale to multi-file firmware.** When `src/radiator/` grows past one `.ino`, expect to revisit (see *Reversal triggers*).
- **No ADR for upload/serial-monitor automation yet.** Manual RESET button press is needed to recapture boot output. Acceptable for hand-testing; would need a wrapper script (or PlatformIO's `monitor_filters = esp32_exception_decoder`-style helpers) before CI smoke-tests can assert on serial output.

## Verification

The bring-up is considered complete when:

1. A fresh checkout follows `poc/lilygo/hello-world/README.md` and reaches a successful compile + upload using `arduino-cli` and the canonical FQBN above.
2. The serial monitor (`arduino-cli monitor` or any pyserial-based equivalent) captures `GottaGo hello world` on `/dev/ttyACM0` at 115200 baud after a physical RESET press.
3. The panel renders `Hello GottaGo` and holds the frame after the board is unplugged (bistable EPD confirmation).
4. The four FQBN keys called out in *Quirks* (`PartitionScheme`, `PSRAM`, `USBMode`, `CDCOnBoot`) are present in the README's `FQBN=` line.
5. The README troubleshooting section covers: 3.x core RMT errors, `--git-url` install mismatch, missing `pyserial`, missing `CDCOnBoot=cdc`, and boot-println timing under native USB CDC.

All five are met as of 2026-05-25.

## References

- GH #29 — *Spike: LilyGO T5 toolchain bring-up — flash a serial Hello World* (this ADR resolves it)
- GH #30, #31, #32 — downstream firmware spikes that build on this toolchain
- [ADR-0005](0005-worker-source-architecture.md) — `src/<project>/` sibling layout that `src/radiator/` will join
- [`../glossary.md`](../glossary.md) — **radiator**, **panel** canonical terms
- `poc/lilygo/hello-world/README.md` — verified bring-up runbook
- LilyGO upstream: <https://github.com/Xinyuan-LilyGO/LilyGo-EPD47>
- Espressif Arduino-ESP32 board manager index: <https://espressif.github.io/arduino-esp32/package_esp32_index.json>
