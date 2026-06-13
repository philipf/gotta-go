# ADR-0006: Radiator firmware toolchain — arduino-cli + ESP32 Arduino core 2.0.15

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** Philip Fourie
- **Runbook:** `src/radiator/README.md` (and `poc/lilygo/hello-world/README.md`) — the verified bring-up steps, the FQBN line, and every board-option quirk. This ADR is the *why*; the README is the *how*.
- **Related:** [ADR-0005](0005-worker-source-architecture.md) (sibling `src/<project>/` toolchain isolation).
- **Resolves:** GH #29 (toolchain bring-up). Unblocks #30–#32.

## Context

GH #29 asked for first contact with the **LilyGO T5 4.7"** board and named three candidate toolchains — PlatformIO, ESP-IDF, Arduino-ESP32. The practical centre of gravity is the vendor's `LilyGo-EPD47` panel driver: whichever toolchain consumes it cleanest wins. ADR-0005 already fixed that firmware lives under `src/radiator/` with its own toolchain; this ADR fills in what that toolchain is.

## Decision

**Arduino-ESP32, driven by `arduino-cli`, pinned to ESP32 core `2.0.15`, with `LilyGo-EPD47@1.0.1` installed from the Arduino Library Manager registry.**

Canonical FQBN (each key is load-bearing — see the README for why):

```
esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,FlashMode=qio,PSRAM=opi,USBMode=hwcdc,CDCOnBoot=cdc
```

### Why this combination

1. **`LilyGo-EPD47@1.0.1` is built for the ESP32 Arduino 2.x core.** On core 3.x (ESP-IDF v5) its `rmt_pulse.c` fails to compile against the new RMT driver API (`unknown type name 'rmt_channel_handle_t'`). **Pin to core 2.0.15** until upstream supports IDF v5; reverify on each library release.
2. **Install from the registry, not `--git-url`.** The registry version is the author's tested release and resolves the `SensorLib` / `Button2` dependencies in one step; the git default branch tracks the in-progress IDF-v5 changes that don't compile.
3. **`arduino-cli` over the IDE.** Headless, scriptable, version-pinnable, fits the repo's CI rhythm. The IDE stays a valid bring-up path and the README documents both.
4. **Arduino-ESP32 over PlatformIO / raw ESP-IDF.** Lowest setup cost for first-flash, vendor docs target it, registry install does dependency resolution. Revisit when the firmware outgrows sketch ergonomics — see *Reversal triggers*.

### Toolchain inventory

| Component | Pinned version | Lives in |
|---|---|---|
| `arduino-cli` | system package (Arch) | host PATH |
| ESP32 Arduino core | `esp32:esp32@2.0.15` | `~/.arduino15/packages/esp32/` |
| `LilyGo-EPD47` | `1.0.1` (registry) | `~/Arduino/libraries/LilyGo-EPD47/` |
| `SensorLib` | `0.4.1` (transitive) | `~/Arduino/libraries/SensorLib/` |
| `Button2` | `2.6.0` (transitive) | `~/Arduino/libraries/Button2/` |
| `pyserial` | `3.5` (active Python) | site-packages |

Board manager URL for the core: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.

## Reversal triggers

Re-evaluate if any fire:

- **`LilyGo-EPD47` ships an ESP32 Arduino 3.x-compatible release** → promote the core pin, reverify the FQBN.
- **The firmware grows past a single-sketch structure** (multiple translation units, shared modules, board-variant abstractions) → revisit PlatformIO / raw ESP-IDF, which handle multi-file projects natively. *(Partially fired — see [ADR-0012](0012-radiator-host-native-tests.md), which added a host-native test build beside arduino-cli rather than switching.)*
- **CI needs to build the firmware** → PlatformIO has more mature CI tooling; only switch if CI is actually being stood up.
- **A second board variant joins** → PlatformIO's `[env:]` matrix beats juggling FQBN strings.

## Consequences

### Positive

- Fast to first-flash; `arduino-cli compile && upload` is the whole CLI loop.
- Registry install resolves `SensorLib` / `Button2` transitively.
- Sibling-symmetric with the Worker (ADR-0005) — neither side's toolchain leaks into the other.

### Negative / follow-ups

- **Pinned to a frozen 2.x branch** — no new IDF features or chip support until the library catches up. Acceptable while the library is the constraint.
- **`pyserial` lives in whichever Python `which python` resolves to**, outside Arduino's package management — a `mise use python@<new>` swap loses it silently. Documented in the README troubleshooting section; a `mise.toml` post-install hook is the eventual fix.
- **arduino-cli is a system package, not mise-managed.** Reproducibility is "follow the README", acceptable for a single developer.

## References

- GH #29 (resolved by this ADR); #30–#32 (downstream firmware spikes)
- [ADR-0005](0005-worker-source-architecture.md) — the `src/<project>/` sibling layout
- `src/radiator/README.md` / `poc/lilygo/hello-world/README.md` — verified bring-up runbook + quirks
- LilyGO upstream: <https://github.com/Xinyuan-LilyGO/LilyGo-EPD47>
