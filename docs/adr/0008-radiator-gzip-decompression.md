# ADR-0008: Radiator gzip decompression library — `uzlib`

- **Status:** Accepted
- **Date:** 2026-05-29
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — **radiator**, **frame**, **wake cycle**.
- **Related contracts:** [ADR-0001](0001-frame-transport-compression.md) (the Worker side: `Content-Encoding: gzip` is mandatory), [ADR-0003](0003-radiator-worker-contract.md) (the wire contract this satisfies), [ADR-0006](0006-radiator-firmware-toolchain.md) (toolchain that pulls the library).
- **Resolves:** firmware AC-F1 of GH #4 (`Accept-Encoding: gzip` on every wake) — the library choice that ADR-0001 deliberately deferred.

## Context

ADR-0001 fixed the Worker side: every `200` from `/v1/frame` carries `Content-Encoding: gzip` and the radiator MUST send `Accept-Encoding: gzip`. It left the firmware-side decoder as "zlib or miniz" and noted "most ESP32 HTTP client libraries already handle `Content-Encoding: gzip` transparently."

That last sentence is wrong for the toolchain ADR-0006 settled on. ESP32 Arduino core 2.0.15's `HTTPClient` (the Wi-Fi/TLS path the wake-cycle PoC #32 already uses) does **not** auto-decompress gzip — it only adds the request header on opt-in (`useHTTP10()` is unrelated), and `getStream()` hands back the raw compressed bytes. The ESP-IDF `esp_http_client` does auto-decompress, but reaching it from an Arduino sketch means giving up the `HTTPClient` ergonomics #32 already proved.

So the radiator has to inflate the body itself. The frame is small in both directions — ~525 B on the wire (measured against `wrangler dev` in the GH #4 Worker-AC comment), exactly 64,862 B inflated — so the decoder needs to be correct, not fast, and small enough not to crowd the ~16 KB free internal RAM the wake path already uses for Wi-Fi + TLS buffers.

## Decision

**Add `uzlib` (Paul Sokolovsky, BSD-2 / zlib licence, pure C) to the radiator sketch via `arduino-cli lib install "uzlib"`, pin the version in `sketch.yaml`, and use its one-shot tinflate API to inflate the whole-response gzip body in PSRAM.**

The compressed body is buffered into a PSRAM scratch buffer (≤ 2 KiB; way under the ~525 B observed), then inflated into a second PSRAM buffer sized for exactly the expected uncompressed frame (`EPD_WIDTH/8 * EPD_HEIGHT + BMP_HEADER_BYTES`, ≈ 64,862 B). No streaming, no chunked inflation, no progress callback.

## Options considered

| Option | Flash cost | RAM cost | Verdict |
|---|---|---|---|
| **`uzlib`** (Arduino registry) | ~6 KB | ~32 KB working state during inflate (PSRAM) | **Chosen** — registry install resolves dependencies; small, mature, well-trodden on ESP32; supports both stream and one-shot APIs |
| **ESP32 ROM `miniz`/`tinflate`** | 0 KB (ROM) | similar | Rejected — the symbols exposed in `rom/miniz.h` vary across IDF minor versions; pinning to core 2.0.15 (per ADR-0006) gives one snapshot, but the ROM contract is undocumented and silently shifts when the core moves |
| **Switch to ESP-IDF `esp_http_client` for transparent decompression** | 0 KB (already in core) | similar | Rejected — would force rewriting #32's `HTTPClient`-based wake path; the auto-decompression saves ~30 lines of inflate glue but costs the whole HTTPS-client port |
| **Skip gzip — request `Accept-Encoding: identity`** | 0 KB | 0 KB | Rejected — violates AC-F1 and ADR-0001; trades ~64 KB of radio-on time per wake for zero firmware complexity, the wrong side of the battery / code tradeoff for a permanent fleet |
| **`miniz` as a vendored library** | ~10 KB | similar | Rejected — same payoff as `uzlib` at higher flash cost and no registry dependency story |
| **Brotli** | ~50 KB+ | ~150 KB | Rejected — already rejected on the Worker side in ADR-0001 for the same reasons |

## Why this preserves "Dumb Radiator, Smart Edge"

ADR-0001 already argued that decompressing a known-format byte stream is a mechanical operation, not a semantic one — the radiator never *interprets* the bytes, just inflates and flushes. This ADR is the firmware sequel: `uzlib_uncompress_chksum()` followed by `decodeBmpToFramebuffer()` (the path #31 already proved) is two mechanical steps with no decision-making in between. Smart-edge invariant intact.

## Consequences

### Positive

- **Closes ADR-0001's open follow-up.** The "either link zlib or miniz" placeholder gets a concrete pin and a measured size.
- **No HTTPS-client port.** Wake-cycle PoC #32's `WiFiClientSecure` + `HTTPClient` shape stays — only the post-GET path changes.
- **Small flash budget.** ~6 KB inflater is dwarfed by the 1.0.1 `LilyGo-EPD47` framebuffer driver already on board.
- **PSRAM is the buffer pool.** The decode framebuffer in show-bmp-31 already lives in PSRAM; the inflated BMP joins it there, leaving the small internal heap for Wi-Fi/TLS.

### Negative / follow-ups

- **Library pin to a single registry version.** `uzlib` doesn't release as often as the EPD library; lock the version in `sketch.yaml` and revalidate on each bump. If the Arduino registry drops `uzlib`, vendor a copy into `src/radiator/uzlib/` and switch the include path — the public API is stable.
- **One-shot inflate needs the full compressed body in RAM.** Negligible at ~525 B today, but a future content profile (e.g. a frame with photographic noise) could push the gzipped body higher. Bound: if compressed size exceeds 8 KB, switch to uzlib's streaming API. Document the switch when measured, not before.
- **No CRC validation by default.** uzlib's one-shot path returns inflated bytes without checking the trailer CRC32 unless asked. The radiator reuses the `to-bmp`-emitted header parse (magic bytes + dimensions + bpp) as a sanity check, which is sufficient for the dumb-radiator: corrupted bytes fail the BMP header check, the panel isn't touched (per ADR-0003's response-handling table), the radiator sleeps and tries again. CRC adds bytes and a second pass over the inflated body — the BMP magic-byte check is cheaper and covers the same failure mode.
- **Inflate happens in `setup()`.** The wake-to-sleep window grows by the inflate time; budget for it in battery accounting. Empirical measurement: log `millis()` before and after `uzlib_uncompress_chksum()` next to the existing wake-to-sleep line.

### Reversal triggers

- The Arduino registry stops shipping `uzlib`, or its API breaks. Vendor a known-good copy under `src/radiator/uzlib/`.
- Compressed body crosses 8 KB sustained. Switch from one-shot to streaming inflate.
- The ESP32 Arduino core gains transparent gzip in `HTTPClient`. Drop `uzlib`.
- A second firmware-side use of decompression appears (e.g. an OTA bundle). Re-evaluate against `miniz`'s broader feature set.

## References

- [ADR-0001](0001-frame-transport-compression.md) — Worker-side decision this completes
- [ADR-0003](0003-radiator-worker-contract.md) — the wire contract this satisfies; firmware response-handling table
- [ADR-0006](0006-radiator-firmware-toolchain.md) — the arduino-cli + esp32:2.0.15 toolchain that pulls the library
- GH #4 — firmware tracer; this ADR unblocks slices #5–#7 of its firmware plan
- [`poc/lilygo/show-bmp-31/show-bmp-31.ino`](../../poc/lilygo/show-bmp-31/show-bmp-31.ino) — the BMP-parse path the inflated bytes feed into
- [`poc/lilygo/wake-cycle-32/wake-cycle-32.ino`](../../poc/lilygo/wake-cycle-32/wake-cycle-32.ino) — the HTTPClient path the inflater plugs into
- uzlib upstream: <https://github.com/pfalcon/uzlib>
