# GottaGo — LilyGO T5 4.7" hello world

Smallest possible sketch that renders one line of text on the **panel** using the bundled FiraSans font. Purpose: prove the toolchain, the board, the EPD driver, and the font path are all alive before anything more ambitious is attempted.

Backs slice **#30** (EPD hello world). Not the final hello world for #30 — this is the "first flash after #29" smoke test. Real text-on-panel work for #30 happens on top of whatever toolchain decision lands in the #29 ADR.

## Hardware

- LilyGO T5 4.7" (ESP32-S3 variant) with OPI PSRAM
- USB-C cable (data, not charge-only)

## Pick a toolchain

Two paths on Omarchy (Arch + Hyprland). Either works for this PoC.

| Path                  | When to use                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `arduino-cli`         | Headless, scriptable, easier to pin in mise later. Recommended for the spike. |
| Arduino IDE 2.x (GUI) | First-time hardware bring-up — install libraries by clicking, watch serial output, twiddle settings in a menu. |

### Path A — arduino-cli

```sh
sudo pacman -S arduino-cli
arduino-cli config init
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32@2.0.15      # LilyGo-EPD47 1.0.1 requires 2.x, NOT 3.x
arduino-cli lib install "LilyGo-EPD47"           # pulls in SensorLib + Button2 automatically
```

The `LilyGo-EPD47` library on the Arduino registry is built against the ESP32 Arduino 2.x core. Installing the latest 3.x core or pulling the library straight from GitHub via `--git-url` will fail with `unknown type name 'rmt_channel_handle_t'` (legacy vs new RMT driver API mismatch). Stick with the registry name and the pinned core.

Esptool, invoked during the compile step, needs `pyserial` available to whatever Python `#!/usr/bin/env python` resolves to:

```sh
sudo pacman -S python-pyserial     # if you use the system Python
pip install pyserial               # if you use a mise/pyenv-managed Python (pacman pkg won't be visible)
```

### Path B — Arduino IDE 2.x

Install from the AUR — slots into the normal `yay -Syu` update cadence and gives you a Walker launcher:

```sh
yay -S arduino-ide-bin
```

<details>
<summary>Fallback: official AppImage</summary>

If you'd rather skip the AUR, the upstream AppImage works too. It needs FUSE 2 because AppImages mount themselves at launch:

```sh
sudo pacman -S fuse2
curl -LO https://downloads.arduino.cc/arduino-ide/arduino-ide_latest_Linux_64bit.AppImage
chmod +x arduino-ide_latest_Linux_64bit.AppImage
./arduino-ide_latest_Linux_64bit.AppImage
```

</details>

Inside the IDE:

1. **File → Preferences → Additional boards manager URLs** → paste `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`.
2. **Tools → Board → Boards Manager** → install **esp32 by Espressif Systems**, version **2.0.15** (drop down the version selector — do not pick the latest 3.x).
3. **Tools → Manage Libraries** → install **LilyGo-EPD47**; when prompted to install missing dependencies, click **Install all** (pulls in SensorLib + Button2).
4. **Tools → Board → ESP32 Arduino → ESP32S3 Dev Module**, then set the rest of the Tools-menu options from the comment block at the top of `hello-world.ino`.
5. **File → Open** → point at `hello-world.ino`. Plug the board in, **Tools → Port** → `/dev/ttyACM0`, click upload, open **Serial Monitor** at 115200.

Hyprland note: the AppImage runs under XWayland by default and is fine. If the window misbehaves (focus, drag, file dialogs), launch with `--ozone-platform=wayland` or fall back to `--ozone-platform=x11`.

### Serial port permissions (either path)

Add your user to the `uucp` group (Arch's serial group) so you can talk to `/dev/ttyACM0` without sudo, then log out and back in:

```sh
sudo usermod -aG uucp $USER
```

## Build, flash, watch (Path A — arduino-cli)

The board's serial port is usually `/dev/ttyACM0` on Arch — confirm with `ls /dev/ttyACM*` after plugging in.

```sh
FQBN='esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,FlashMode=qio,PSRAM=opi,USBMode=hwcdc,CDCOnBoot=cdc'
PORT=/dev/ttyACM0

arduino-cli compile --fqbn "$FQBN" .
arduino-cli upload  --fqbn "$FQBN" -p "$PORT" .
arduino-cli monitor -p "$PORT" -c baudrate=115200
```

## Expected result

- Serial monitor prints `GottaGo hello world` once at boot.
- Panel does one full refresh (white) then shows `Hello GottaGo` roughly mid-screen.
- Panel holds the frame after the board is unplugged — that's the bistable EPD doing its thing.

## Troubleshooting

- **`Please enable PSRAM` compile error** — the FQBN above sets `PSRAM=opi`. If you're using a different invocation, make sure OPI PSRAM is on.
- **`ModuleNotFoundError: No module named 'serial'` during compile** — esptool's `#!/usr/bin/env python` is resolving to a Python that doesn't have `pyserial`. Common when you use mise/pyenv: `pacman -S python-pyserial` installs into the system Python, which isn't first on `PATH`. Fix with `pip install pyserial` against whatever `which python` reports.
- **`unknown type name 'rmt_channel_handle_t'` during compile** — you're on the ESP32 3.x core. Downgrade to 2.0.15: `arduino-cli core install esp32:esp32@2.0.15` (this replaces the 3.x core).
- **Panel renders correctly but serial monitor shows nothing** — `CDCOnBoot=cdc` is missing from the FQBN. Without it, `Serial` is routed to UART0 pins instead of the USB CDC interface on `/dev/ttyACM0`. The boot `println` also fires before the host can re-attach after upload — press the RESET button with the monitor already open to see it.
- **Upload fails / port busy** — close any open `arduino-cli monitor`; the port can't be shared.
- **Panel stays blank** — try a slow double-press of RESET after upload. Some T5 variants need a manual reset to start the new sketch.
- **Text in the wrong place** — `cursor_y` in the LilyGo-EPD47 library is the *baseline* of the glyph, not the top. Nudge it if needed.

## What this does NOT prove

- 1-bit BMP byte-array flush (that's slice #31).
- Wi-Fi, deep sleep, wake cycle (that's slice #32).
- Press Start 2P rendering — we're using the library's bundled FiraSans here. Press Start 2P needs a font-format conversion, deferred to slice #30's main work.
