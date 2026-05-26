/**
 * GottaGo — LilyGO T5 4.7" EPD: flush a pre-rendered 1-bit BMP to the panel
 *
 * Spike #31. Validates the BMP -> panel handoff that #1 depends on: take a real
 * 1-bit 960x540 BMP produced by poc/to-bmp, embed it as a const byte array, and
 * flush it to the panel via the EPD driver. No SD card, no network — isolated to
 * the BMP-to-panel question.
 *
 * The embedded frame (time_bmp.h) is a Windows BMP, BITMAPINFOHEADER, 1 bpp:
 *   - 960 x 540, top-down (biHeight = -540)
 *   - MSB-first bit packing: pixel x lives in bit (0x80 >> (x & 7))
 *   - palette idx 0 = white, idx 1 = black; a set bit therefore means BLACK (ink)
 *   - 120-byte row stride (960 / 8), already 4-byte aligned, no row padding
 * See README.md for the full transform rationale.
 *
 * Board settings — identical to ../hello-world (see that sketch's header / its
 * sketch.yaml for the FQBN). PSRAM (OPI) is required for the framebuffer.
 */

#ifndef BOARD_HAS_PSRAM
#error "Enable PSRAM: Arduino IDE -> Tools -> PSRAM -> OPI"
#endif

#include <Arduino.h>
#include "epd_driver.h"
#include "time_bmp.h"

// Little-endian field readers over the flash-resident BMP byte array.
static uint16_t bmpU16(const uint8_t *p, uint32_t off) {
    return (uint16_t)p[off] | ((uint16_t)p[off + 1] << 8);
}
static uint32_t bmpU32(const uint8_t *p, uint32_t off) {
    return (uint32_t)p[off] | ((uint32_t)p[off + 1] << 8) |
           ((uint32_t)p[off + 2] << 16) | ((uint32_t)p[off + 3] << 24);
}
static int32_t bmpI32(const uint8_t *p, uint32_t off) {
    return (int32_t)bmpU32(p, off);
}

// Decode the embedded 1-bit BMP straight into a 4bpp EPD framebuffer.
// Returns true on success; logs the reason and returns false on a format we
// don't handle (this spike only claims to read what poc/to-bmp emits).
static bool decodeBmpToFramebuffer(const uint8_t *bmp, uint32_t len, uint8_t *fb) {
    if (len < 62 || bmp[0] != 'B' || bmp[1] != 'M') {
        Serial.println("BMP: bad magic / too short");
        return false;
    }

    const uint32_t dataOffset = bmpU32(bmp, 10);
    const int32_t  width      = bmpI32(bmp, 18);
    const int32_t  rawHeight  = bmpI32(bmp, 22);
    const uint16_t bpp        = bmpU16(bmp, 28);
    const uint32_t compression = bmpU32(bmp, 30);

    const bool    topDown = rawHeight < 0;            // negative biHeight => rows stored top-first
    const int32_t height  = topDown ? -rawHeight : rawHeight;

    Serial.printf("BMP: %ldx%ld %ubpp comp=%lu offset=%lu %s\n",
                  (long)width, (long)height, bpp, (unsigned long)compression,
                  (unsigned long)dataOffset, topDown ? "top-down" : "bottom-up");

    if (bpp != 1 || compression != 0) {
        Serial.println("BMP: expected uncompressed 1bpp");
        return false;
    }
    if (width != EPD_WIDTH || height != EPD_HEIGHT) {
        Serial.printf("BMP: expected %dx%d to match panel\n", EPD_WIDTH, EPD_HEIGHT);
        return false;
    }

    // Row stride: BMP rows are padded up to a 4-byte boundary. For 960px @ 1bpp
    // that is exactly 120 bytes, so the +31 rounding is a no-op here, but we
    // compute it honestly so a differently-sized frame still decodes.
    const uint32_t rowStride = (((uint32_t)width * bpp + 31) / 32) * 4;

    if (dataOffset + rowStride * (uint32_t)height > len) {
        Serial.println("BMP: pixel data runs past end of array");
        return false;
    }

    for (int32_t srcRow = 0; srcRow < height; srcRow++) {
        // Map the file's row order onto panel y (top = 0). Our frames are
        // top-down, so srcRow maps straight to y; the else-branch keeps this
        // correct if the encoder ever switches to bottom-up.
        const int32_t y = topDown ? srcRow : (height - 1 - srcRow);
        const uint8_t *row = bmp + dataOffset + (uint32_t)srcRow * rowStride;

        for (int32_t x = 0; x < width; x++) {
            const uint8_t bit = (row[x >> 3] >> (7 - (x & 7))) & 0x01; // MSB-first
            if (bit) {
                // Set bit = palette idx 1 = black = ink on. The framebuffer is
                // pre-filled white, so we only need to stamp the black pixels.
                epd_draw_pixel(x, y, 0x00, fb);
            }
        }
    }
    return true;
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("GottaGo show-bmp #31");

    epd_init();

    // 4bpp framebuffer: EPD_WIDTH/2 * EPD_HEIGHT bytes (two 4-bit pixels per byte).
    const size_t fbSize = EPD_WIDTH / 2 * EPD_HEIGHT;
    uint8_t *fb = (uint8_t *)heap_caps_malloc(fbSize, MALLOC_CAP_SPIRAM);
    if (!fb) {
        Serial.println("framebuffer alloc failed — is OPI PSRAM enabled?");
        return;
    }
    memset(fb, 0xFF, fbSize); // 0xF nibble = white; black pixels get stamped in

    const uint32_t t0 = millis();
    const bool ok = decodeBmpToFramebuffer(time_bmp, time_bmp_len, fb);
    Serial.printf("decode: %s in %lu ms\n", ok ? "ok" : "FAILED",
                  (unsigned long)(millis() - t0));
    if (!ok) {
        free(fb);
        return;
    }

    epd_poweron();
    epd_clear();                                      // wipe to avoid ghosting
    epd_draw_grayscale_image(epd_full_screen(), fb);  // full-frame flush
    epd_poweroff();

    free(fb);
    Serial.println("frame latched");
}

void loop() {
    // Render once at boot, then idle — the bistable panel holds the frame.
    delay(1000);
}
