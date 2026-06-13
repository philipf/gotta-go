#include "frame.h"

#include <Arduino.h>

#include "epd_driver.h"

// Little-endian field readers over a flash- or PSRAM-resident BMP byte array.
static uint16_t bmpU16(const uint8_t* p, uint32_t off) {
    return (uint16_t)p[off] | ((uint16_t)p[off + 1] << 8);
}
static uint32_t bmpU32(const uint8_t* p, uint32_t off) {
    return (uint32_t)p[off] | ((uint32_t)p[off + 1] << 8) | ((uint32_t)p[off + 2] << 16) |
           ((uint32_t)p[off + 3] << 24);
}
static int32_t bmpI32(const uint8_t* p, uint32_t off) {
    return (int32_t)bmpU32(p, off);
}

bool decodeBmpToFramebuffer(const uint8_t* bmp, uint32_t len, uint8_t* fb) {
    if (len < 62 || bmp[0] != 'B' || bmp[1] != 'M') {
        Serial.println("BMP: bad magic / too short");
        return false;
    }
    const uint32_t dataOffset  = bmpU32(bmp, 10);
    const int32_t width        = bmpI32(bmp, 18);
    const int32_t rawHeight    = bmpI32(bmp, 22);
    const uint16_t bpp         = bmpU16(bmp, 28);
    const uint32_t compression = bmpU32(bmp, 30);
    const bool topDown         = rawHeight < 0;
    const int32_t height       = topDown ? -rawHeight : rawHeight;

    Serial.printf("BMP: %ldx%ld %ubpp comp=%lu offset=%lu %s\n", (long)width, (long)height, bpp,
                  (unsigned long)compression, (unsigned long)dataOffset,
                  topDown ? "top-down" : "bottom-up");

    if (bpp != 1 || compression != 0) {
        Serial.println("BMP: expected uncompressed 1bpp");
        return false;
    }
    if (width != EPD_WIDTH || height != EPD_HEIGHT) {
        Serial.printf("BMP: expected %dx%d to match panel\n", EPD_WIDTH, EPD_HEIGHT);
        return false;
    }

    const uint32_t rowStride = (((uint32_t)width * bpp + 31) / 32) * 4;
    if (dataOffset + rowStride * (uint32_t)height > len) {
        Serial.println("BMP: pixel data runs past end of array");
        return false;
    }

    for (int32_t srcRow = 0; srcRow < height; srcRow++) {
        const int32_t y    = topDown ? srcRow : (height - 1 - srcRow);
        const uint8_t* row = bmp + dataOffset + (uint32_t)srcRow * rowStride;
        for (int32_t x = 0; x < width; x++) {
            const uint8_t bit = (row[x >> 3] >> (7 - (x & 7))) & 0x01;
            if (bit) {
                // Set bit = palette idx 1 = black = ink on. The framebuffer
                // is pre-filled white, so we stamp only the black pixels.
                epd_draw_pixel(x, y, 0x00, fb);
            }
        }
    }
    return true;
}

bool flushToPanel(const uint8_t* bmp, size_t bmpLen) {
    const size_t fbSize = EPD_WIDTH / 2 * EPD_HEIGHT;
    uint8_t* fb         = (uint8_t*)heap_caps_malloc(fbSize, MALLOC_CAP_SPIRAM);
    if (!fb) {
        Serial.println("framebuffer alloc failed — PSRAM exhausted?");
        return false;
    }
    memset(fb, 0xFF, fbSize);  // 0xF nibble = white

    const uint32_t t0 = millis();
    if (!decodeBmpToFramebuffer(bmp, (uint32_t)bmpLen, fb)) {
        free(fb);
        return false;
    }
    Serial.printf("decode: ok in %lu ms\n", (unsigned long)(millis() - t0));

    epd_poweron();
    epd_clear();  // wipe to avoid ghosting
    epd_draw_grayscale_image(epd_full_screen(), fb);
    epd_poweroff();

    free(fb);
    Serial.println("panel: frame latched");
    return true;
}
