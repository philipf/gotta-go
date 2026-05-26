# GottaGo — LilyGO T5 4.7": flush a pre-rendered 1-bit BMP to the panel

Spike **#31**. Validates the **BMP → panel** handoff that **#1** depends on: take a real 1-bit 960×540 BMP produced by [`poc/to-bmp`](../../to-bmp/), embed it as a `const` byte array in firmware, and flush it to the **panel** via the EPD driver. No SD card, no network — deliberately isolated to the one question: *do the encoder's bit-packing, row order, and polarity match what the panel expects?*

This is the load-bearing link between the Worker-side rendering pipeline and the radiator hardware. Directly satisfies the third acceptance criterion of #1, and resolves the "real hardware row order" open question flagged in [`poc/to-bmp/hand-off-next-steps.md`](../../to-bmp/hand-off-next-steps.md).

Builds on [`../hello-world`](../hello-world/) (slice #30) for the toolchain, board settings, and EPD call sequence — read that README first; this one only covers what's different.

## Files

| File | Purpose |
| --- | --- |
| `show-bmp-31.ino` | The sketch: parse the BMP header, decode pixels into a 4bpp framebuffer, flush. |
| `time.bmp` | Input frame — a real `poc/to-bmp` output (960×540, 1-bit). |
| `time_bmp.h` | `time.bmp` embedded as a `const uint8_t[]`. Generated; do not hand-edit. |
| `bmp_to_header.py` | Regenerates `time_bmp.h` from any `.bmp`. Raw byte dumper, not BMP-aware. |
| `sketch.yaml` / `mise.toml` | Toolchain config (same FQBN as hello-world). |

## Build, flash, watch

Same toolchain as `../hello-world` (arduino-cli + esp32 core 2.0.15 + LilyGo-EPD47). With `sketch.yaml` present you can drop the `--fqbn`:

```sh
arduino-cli compile .
arduino-cli upload -p /dev/ttyACM0 .
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

### Upload fails with `No serial data received`

On this T5 (ESP32-S3, native USB) `arduino-cli upload` repeatedly died right after `Stub running... / Changing baud rate`, with `A fatal error occurred: No serial data received`. It is **not** a baud-rate or sketch problem — esptool's stub re-initialises the USB peripheral, the port re-enumerates, and esptool loses the handle. Lowering `UploadSpeed` or retrying does not help.

Fix: park the board in ROM download mode by hand so the link stays stable, then upload:

1. Hold **BOOT** (IO0).
2. Tap **RST** once while holding BOOT.
3. Release BOOT. (Panel goes blank — expected; it's in the bootloader.)
4. Run `arduino-cli upload -p /dev/ttyACM0 .`
5. Tap **RST** again to leave download mode and run the sketch — the frame renders now.

If it still drops mid-write, keep BOOT held until esptool starts writing, then release. Expect to need this for every flash on this unit (#32 included).

## Regenerating the embedded frame

The firmware embeds `time.bmp` rather than reading an SD card or the network, so a new frame means re-embedding:

```sh
# drop the new poc/to-bmp output in as time.bmp, then:
python3 bmp_to_header.py time.bmp time_bmp.h
```

`bmp_to_header.py` is a plain byte dumper — it knows nothing about the BMP layout. The firmware (`decodeBmpToFramebuffer`) is the single source of truth for header parsing. On the ESP32-S3 a `const` array lives in memory-mapped flash, so the array is indexed like ordinary RAM — no `PROGMEM` / `pgm_read_*`.

## Expected result

- Serial prints the parsed header: `BMP: 960x540 1bpp comp=0 offset=62 top-down`, then `decode: ok in <N> ms` and `frame latched`.
- Panel does one full refresh (white) then shows the rendered frame in correct **landscape** orientation: text upright and reading left-to-right, black ink on white, no mirroring, no diagonal skew, no banding.
- Panel holds the frame after the board is unplugged (bistable EPD).

## The BMP format this consumes, and the transforms applied

This is the contract acceptance-criterion #4 asks us to pin down, so the Worker side can either emit exactly this or apply a transform knowing *why*. Everything below is what [`poc/to-bmp`](../../to-bmp/index.ts)'s `rgbaTo1BitBmp()` emits, verified against `time.bmp`'s header (`od -An -tx1 -N 62 time.bmp`).

| Property | Value | What the firmware does |
| --- | --- | --- |
| Container | Windows BMP, `BITMAPINFOHEADER` (40-byte), 62-byte header total | Parses the header (reads data offset, dimensions, bpp, compression) rather than assuming a fixed 62. |
| Pixel format | 1 bpp, uncompressed (`biCompression = 0`) | Rejects anything else with a serial message. |
| Dimensions | 960 × 540 | Must equal `EPD_WIDTH × EPD_HEIGHT`. |
| **Row order** | **Top-down** (`biHeight = -540`) | File row 0 = top of panel → maps straight to framebuffer `y = 0`. **No flip applied.** The decoder still handles bottom-up (positive `biHeight`) by reversing, so the encoder *could* switch, but top-down is the confirmed-good path — keep emitting it and the firmware stays flip-free. |
| **Bit order** | **MSB-first**: pixel `x` is bit `0x80 >> (x & 7)` of its byte | Reads `(byte >> (7 - (x & 7))) & 1`. **No endianness swap.** |
| **Polarity** | Palette idx 0 = white, idx 1 = black; a **set bit = black (ink on)** | Pre-fills the framebuffer white (`0xFF`) and stamps only set bits as black (`epd_draw_pixel(x, y, 0x00, fb)`). **No inversion.** (The 8-byte palette is *assumed*, not parsed — this matches the encoder; a palette flip there would need a firmware change.) |
| **Row padding** | 120-byte stride (960 / 8), already 4-byte aligned → **zero padding** | Computes the 4-byte-aligned stride `(((w·bpp)+31)/32)·4` honestly; for 960×1bpp it's a no-op, but a resized frame still decodes. |

**Net result for the Worker side: emit the BMP exactly as `to-bmp` does today and the panel needs no transform.** The firmware applies none — no row flip, no bit swap, no inversion, no padding strip. The only conversion is the unavoidable 1bpp → 4bpp expansion the EPD framebuffer requires (each ink bit becomes a `0x0` nibble; background stays `0xF`), which is internal to the panel and invisible to the encoder.

If a future hardware test shows the panel rendering **upside-down**, the fix is on the encoder: flip `biHeight`'s sign in `rgbaTo1BitBmp()` and reverse its row loop. This firmware would follow it automatically via the top-down/bottom-up branch.

## EPD call sequence

Identical in shape to hello-world (`epd_init` → `epd_poweron` → `epd_clear` → draw → `epd_poweroff`), with the draw step swapped for a full-frame image flush instead of `writeln`:

```c
epd_init();                                   // once: RMT + framebuffer config
uint8_t *fb = heap_caps_malloc(EPD_WIDTH/2 * EPD_HEIGHT, MALLOC_CAP_SPIRAM);
memset(fb, 0xFF, EPD_WIDTH/2 * EPD_HEIGHT);   // 0xF nibble = white
decodeBmpToFramebuffer(time_bmp, time_bmp_len, fb);
epd_poweron();
epd_clear();                                  // wipe to avoid ghosting
epd_draw_grayscale_image(epd_full_screen(), fb);
epd_poweroff();                               // panel latches the frame
```

The framebuffer is **4bpp** (`EPD_WIDTH/2 * EPD_HEIGHT` = 259,200 bytes, two 4-bit grayscale pixels per byte), allocated in **PSRAM** — it does not fit in internal RAM, which is why OPI PSRAM is mandatory. We decode the 1-bit source into it via `epd_draw_pixel(x, y, color, fb)` where `color` is 0–255 grayscale (`0x00` = black, `0xFF` = white); the driver writes the high nibble into the right pixel slot. Using `epd_draw_pixel` keeps the nibble-packing inside the driver, so the only thing this sketch has to get right is the BMP-side bit math above.

## What this does NOT prove

- Wi-Fi, deep sleep, wake cycle (slice #32).
- Reading a BMP off SD or the network — the frame is embedded on purpose.
- Partial refresh — full refresh only, same as hello-world.
- Press Start 2P font conversion — the embedded frame was rendered Worker-side; the panel just blits bits.
