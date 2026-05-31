/**
 * frame.{h,cpp} — the radiator's frame module (ported from poc/lilygo/show-bmp-31).
 *
 * Decodes an inflated 1-bit BMP into the EPD's 4bpp framebuffer and flushes it
 * to the panel. Consumes already-decompressed bytes — decompression is the body
 * I/O layer's job (net::inflateGzip), shared with the error path (ADR-0008 / the
 * #63 split). decodeBmpToFramebuffer's validation is pure and host-tested; the
 * panel flush is device-only.
 *
 * Extracted from radiator.ino per GH #63.
 */
#pragma once

#include <cstddef>
#include <cstdint>

// Expected uncompressed frame size (BMP header + 1bpp pixel data for 960x540).
// Drives the inflate destination cap and the post-inflate size check.
static const size_t EXPECTED_BMP_BYTES = 64862;

// Validate a 1bpp BMP byte array and stamp its black pixels into the pre-filled
// (white) EPD framebuffer fb. Returns false — leaving fb untouched-or-partial —
// when the bytes are not a panel-sized (960x540) uncompressed 1bpp BMP. Pure
// apart from the per-pixel epd_draw_pixel writes into fb, so it's host-testable.
bool decodeBmpToFramebuffer(const uint8_t *bmp, uint32_t len, uint8_t *fb);

// Allocate a framebuffer, decode bmp into it, and latch it on the panel. Returns
// false on a bad BMP or PSRAM exhaustion (→ BmpInvalid). Device-only.
bool flushToPanel(const uint8_t *bmp, size_t bmpLen);
